/* Content Studio Tracker v1.4 — Supabase Auth, этап A (до закрытия RLS) */
(() => {
  const CFG = window.CONTENT_STUDIO_CONFIG || {};
  const hasRealConfig = () => /^https:\/\/.+\.supabase\.co$/i.test(CFG.SUPABASE_URL || '') && /^(sb_publishable_|eyJ)/.test(CFG.SUPABASE_PUBLISHABLE_KEY || '');
  const authStorage = {
    getItem(key){ return sessionStorage.getItem(key) ?? localStorage.getItem(key); },
    setItem(key,value){
      const persist = localStorage.getItem('cst_auth_remember') !== '0';
      const target = persist ? localStorage : sessionStorage;
      const other = persist ? sessionStorage : localStorage;
      other.removeItem(key); target.setItem(key,value);
    },
    removeItem(key){ localStorage.removeItem(key); sessionStorage.removeItem(key); }
  };
  const client = hasRealConfig() && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:authStorage}
  }) : null;
  const AUTH_REDIRECT_URL = `${location.origin}${location.pathname}`;
  const authLinkParams = new URLSearchParams((location.hash||'').replace(/^#/,''));
  const authQueryParams = new URLSearchParams(location.search||'');
  let pendingAuthFlow = authLinkParams.get('type') || authQueryParams.get('type') || null;

  const state = { mode: client ? 'live' : 'demo', currentPage:'dashboard', materials:[], publications:[], postStats:[], audience:[], ideas:[], resources:[] };
  const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const fmtDate = d => d ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(d+'T12:00:00')) : '—';
  const num = n => new Intl.NumberFormat('ru-RU').format(Number(n||0));
  const labelMap = {
    idea:'Идея',in_progress:'В работе',review:'На проверке',ready:'Готово',scheduled:'Запланировано',published:'Опубликовано',removed:'Снято',draft:'Черновик',archived:'Архив',
    worksheet:'Worksheet',reading_pack:'Reading Pack',vocabulary_pack:'Vocabulary Pack',grammar_pack:'Grammar Pack',phonics:'Phonics',speaking:'Speaking',listening:'Listening',writing:'Writing',test:'Test',olympiad:'Olympiad',poster_cards:'Posters & Cards',interactive_game:'Interactive Game',presentation:'Presentation',video_lesson:'Video Lesson',culture_corner:'Culture Corner',holiday_pack:'Holiday Pack',other:'Другое',
    new:'Новая',planned:'Запланирована',converted:'Создан материал',normal:'Обычный',high:'Высокий',low:'Низкий',brand:'Бренд',template:'Шаблон',folder:'Папка',service:'Сервис',reference:'Справочник'
  };
  const label = v => labelMap[v] || v || '—';
  const platformMap = {vk:'VK',telegram:'Telegram',github_pages:'GitHub Pages',website:'Сайт',other:'Другое'};
  const platformLabel = v => platformMap[v] || String(v||'—').toUpperCase();
  const toast = msg => { const el=$('#toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2400); };
  const safeFileName = name => String(name||'cover').toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'') || 'cover';
  const materialCover = m => m?.cover_url || 'assets/brand-logo.png';
  const publicationHistory = materialId => [...state.publications].filter(p=>p.material_id===materialId).sort((a,b)=>(b.publication_date||'').localeCompare(a.publication_date||''));
  const activePublications = materialId => publicationHistory(materialId).filter(p=>p.status==='published');
  const materialPublication = materialId => activePublications(materialId)[0] || publicationHistory(materialId)[0];
  const materialLatestStat = materialId => {
    const stats=publicationHistory(materialId).map(p=>latestStat(p.id)).filter(Boolean);
    if(!stats.length) return null;
    return stats.reduce((a,x)=>({views:a.views+Number(x.views||0),likes:a.likes+Number(x.likes||0),comments:a.comments+Number(x.comments||0),reposts:a.reposts+Number(x.reposts||0)}),{views:0,likes:0,comments:0,reposts:0});
  };

  async function uploadMaterialCover(file){
    if(!file) return null;
    if(!file.type?.startsWith('image/')) throw new Error('Выберите изображение PNG, JPG или WEBP.');
    if(file.size>6*1024*1024) throw new Error('Обложка слишком большая. Максимум 6 МБ.');
    if(!client){
      return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Не удалось прочитать изображение'));r.readAsDataURL(file);});
    }
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const stem=safeFileName(file.name.replace(/\.[^.]+$/,''));
    const uid=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
    const path=`materials/${Date.now()}-${uid}-${stem}.${ext}`;
    const {error}=await client.storage.from('material-covers').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
    if(error) throw error;
    const {data}=client.storage.from('material-covers').getPublicUrl(path);
    return data?.publicUrl||null;
  }

  function storagePathFromPublicUrl(url){
    if(!url||!url.includes('/storage/v1/object/public/material-covers/')) return null;
    return decodeURIComponent(url.split('/storage/v1/object/public/material-covers/')[1]||'') || null;
  }
  async function removeStoredCover(url){
    if(!client) return;
    const path=storagePathFromPublicUrl(url);
    if(path) await client.storage.from('material-covers').remove([path]);
  }

  const demo = {
    materials:[
      {id:'m1',title:'Back to School Adventure',level:'A1-A2',age_group:'8-9',material_type:'reading_pack',formats:['pdf','pptx'],topic:'Back to School',skills:['reading','vocabulary','speaking'],status:'published',created_date:'2026-08-10',planned_publish_date:null,files_url:null,live_url:null,notes:'Тестовая запись для Content Studio Tracker'},
      {id:'m2',title:'Flag Day',level:'A2',age_group:'10-12',material_type:'holiday_pack',formats:['pdf','docx'],topic:'Holidays in Russia',skills:['reading','vocabulary','speaking'],status:'ready',created_date:'2026-08-09',planned_publish_date:'2026-08-15'},
      {id:'m3',title:'Phonics Fun — Letter Uu',level:'A0-A1',age_group:'6-7',material_type:'phonics',formats:['pdf','html'],topic:'Phonics',skills:['phonics','reading'],status:'published',created_date:'2026-08-03',live_url:'https://example.com'},
      {id:'m4',title:'Spotlight 3 Vocabulary Revision',level:'A1-A2',age_group:'8-9',material_type:'vocabulary_pack',formats:['pdf'],topic:'Vocabulary Revision',skills:['vocabulary','writing'],status:'in_progress',created_date:'2026-08-08',planned_publish_date:'2026-08-18'},
      {id:'m5',title:'Secret Animal Messages',level:'A1-A2',age_group:'8-9',material_type:'worksheet',formats:['pdf','pptx'],topic:'Animals',skills:['reading','grammar','vocabulary'],status:'review',created_date:'2026-08-07'},
      {id:'m6',title:'City Detective',level:'A2',age_group:'10-12',material_type:'interactive_game',formats:['html'],topic:'City Places',skills:['vocabulary','speaking'],status:'scheduled',created_date:'2026-08-05',planned_publish_date:'2026-08-20'}
    ],
    publications:[
      {id:'p1',material_id:'m1',platform:'vk',publication_date:'2026-08-10',status:'published',post_url:null,notes:'Тестовая публикация'},
      {id:'p2',material_id:'m3',platform:'vk',publication_date:'2026-08-04',status:'published'},
      {id:'p3',material_id:'m6',platform:'vk',publication_date:'2026-08-20',status:'scheduled'}
    ],
    postStats:[
      {id:'s1',publication_id:'p1',snapshot_date:'2026-08-10',views:2850,likes:196,comments:27,reposts:21},
      {id:'s2',publication_id:'p2',snapshot_date:'2026-08-05',views:4180,likes:302,comments:41,reposts:37}
    ],
    audience:[{id:'a1',platform:'vk',snapshot_date:'2026-08-10',total_members:12450,joined:18,left_count:3,net_change:15}],
    ideas:[{id:'i1',title:'Detective Grammar Game',level:'A2',topic:'Past Simple',material_type:'interactive_game',priority:'high',status:'new',notes:'Создать интерактивную детективную игру по Past Simple'}],
    resources:[{id:'r1',title:'Логотип Копилочка Английского',category:'brand',url:null,description:'Основной фирменный логотип проекта',is_favorite:true}]
  };

  async function loadAll(){
    if (!client){ Object.assign(state, JSON.parse(JSON.stringify(demo))); state.mode='demo'; renderAll(); return; }
    state.mode='live';
    const tables=[['materials','materials'],['publications','publications'],['post_stats','postStats'],['audience_stats','audience'],['ideas','ideas'],['resources','resources']];
    try{
      await Promise.all(tables.map(async ([table,key])=>{ const {data,error}=await client.from(table).select('*'); if(error) throw error; state[key]=data||[]; }));
      renderAll();
    }catch(e){ console.error(e); Object.assign(state, JSON.parse(JSON.stringify(demo))); state.mode='demo'; renderAll(); toast('Не удалось прочитать Supabase — включён демо-режим'); }
  }

  function renderAll(){
    $('#modePill').textContent=state.mode==='live'?'Supabase ✓':'Демо';
    $('#modePill').className='mode-pill';
    $('#demoBanner').classList.toggle('hidden',state.mode==='live');
    renderDashboard(); renderMaterials(); renderPlan(); renderPublications(); renderAnalytics(); renderIdeas(); renderResources(); populateFilters();
  }

  function renderDashboard(){
    const total=state.materials.length, ready=state.materials.filter(x=>x.status==='ready').length, scheduled=state.publications.filter(x=>x.status==='scheduled').length;
    const latestStats=[...state.postStats].sort((a,b)=>(b.likes||0)-(a.likes||0))[0];
    const topPub=latestStats?state.publications.find(p=>p.id===latestStats.publication_id):null; const topMat=topPub?state.materials.find(m=>m.id===topPub.material_id):null;
    $('#kpiGrid').innerHTML=[
      ['▤','Всего материалов',total,'в библиотеке'],['★','Готовы к публикации',ready,'можно планировать'],['▦','Запланировано',scheduled,'публикаций'],['♛','Лучший пост',topMat?topMat.title:'—',latestStats?`${num(latestStats.likes)} лайков`:'нет данных']
    ].map(([i,t,v,s])=>`<article class="kpi"><div class="icon">${i}</div><h3>${esc(t)}</h3><strong>${esc(v)}</strong><small>${esc(s)}</small></article>`).join('');
    const statusDefs=[['idea','Идея','Замыслы'],['in_progress','В работе','Создаётся'],['ready','Готово','Готово к публикации'],['published','Опубликовано','Уже в эфире']];
    $('#statusBoard').innerHTML=statusDefs.map(([k,t,p])=>`<div class="status-cell"><h4>${t}</h4><strong>${state.materials.filter(x=>x.status===k).length}</strong><p>${p}</p></div>`).join('');
    $('#recentMaterialsBody').innerHTML=[...state.materials].sort((a,b)=>(b.created_date||'').localeCompare(a.created_date||'')).slice(0,5).map(m=>`<tr><td><strong>${esc(m.title)}</strong></td><td>${esc(m.level||'—')}</td><td>${esc(label(m.material_type))}</td><td><div class="format-tags">${(m.formats||[]).map(f=>`<span class="format-tag">${esc(f.toUpperCase())}</span>`).join('')}</div></td><td><span class="badge ${esc(m.status)}">${esc(label(m.status))}</span></td></tr>`).join('')||'<tr><td colspan="5">Пока нет материалов</td></tr>';
    renderCalendar();
    const latestAudience=[...state.audience].sort((a,b)=>(b.snapshot_date||'').localeCompare(a.snapshot_date||''))[0]||{};
    const views=state.postStats.reduce((s,x)=>s+(x.views||0),0), likes=state.postStats.reduce((s,x)=>s+(x.likes||0),0), reposts=state.postStats.reduce((s,x)=>s+(x.reposts||0),0);
    $('#miniMetrics').innerHTML=[['👁','Просмотры',views],['♥','Лайки',likes],['↗','Репосты',reposts],['♙','Прирост',latestAudience.net_change||0]].map(([i,t,v])=>`<div class="mini-metric"><span>${i} ${t}</span><strong>${v>0&&t==='Прирост'?'+':''}${num(v)}</strong></div>`).join('');
  }

  function renderCalendar(){
    const now=new Date(); const y=now.getFullYear(), m=now.getMonth(); const first=new Date(y,m,1), days=new Date(y,m+1,0).getDate(); const shift=(first.getDay()+6)%7;
    $('#calendarTitle').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(first);
    const events=new Set(state.materials.map(x=>x.planned_publish_date).filter(Boolean).map(x=>Number(x.slice(8,10))));
    let html=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<div class="cal-label">${d}</div>`).join('');
    html+=Array.from({length:shift},()=>'<div></div>').join('');
    for(let d=1;d<=days;d++){ const cls=[d===now.getDate()&&m===now.getMonth()?'today':'',events.has(d)?'has-event':''].filter(Boolean).join(' '); html+=`<div class="cal-day ${cls}">${d}</div>`; }
    $('#calendarGrid').innerHTML=html;
  }

  function populateFilters(){
    const statuses=['idea','in_progress','review','ready','scheduled','published','archived']; $('#materialsStatusFilter').innerHTML='<option value="">Все статусы</option>'+statuses.map(s=>`<option value="${s}">${label(s)}</option>`).join('');
    const levels=[...new Set(state.materials.map(x=>x.level).filter(Boolean))].sort(); $('#materialsLevelFilter').innerHTML='<option value="">Все уровни</option>'+levels.map(s=>`<option>${esc(s)}</option>`).join('');
  }

  function renderMaterials(){
    const q=($('#materialsSearch')?.value||'').toLowerCase(), status=$('#materialsStatusFilter')?.value||'', level=$('#materialsLevelFilter')?.value||'';
    const arr=state.materials.filter(m=>(!q||[m.title,m.topic,m.level,m.material_type].join(' ').toLowerCase().includes(q))&&(!status||m.status===status)&&(!level||m.level===level));
    $('#materialsCards').innerHTML=arr.map(m=>{
      const stat=materialLatestStat(m.id), history=publicationHistory(m.id), active=activePublications(m.id);
      const pubButton=history.length
        ? `<button class="small-btn publication-summary-btn" data-material-publications="${esc(m.id)}">${active.length?`Опубликовано: ${active.length}`:`История публикаций: ${history.length}`} ▾</button>`
        : '';
      return `<article class="material-card card-lift">
        <div class="material-cover"><img src="${esc(materialCover(m))}" alt="Обложка ${esc(m.title)}"><span class="badge ${esc(m.status)} cover-status">${esc(label(m.status))}</span></div>
        <div class="material-card__body">
          <h3>${esc(m.title)}</h3>
          <div class="meta material-meta">${esc(m.level||'—')} · ${esc(m.age_group||'возраст не указан')} · ${esc(label(m.material_type))}</div>
          <div class="chip-row material-formats">${(m.formats||[]).map(x=>`<span class="chip chip-format">${esc(x.toUpperCase())}</span>`).join('')}</div>
          <div class="chip-row material-skills">${(m.skills||[]).map(x=>`<span class="chip">${esc(x.toUpperCase())}</span>`).join('')}</div>
          <div class="material-info-row"><span>📅 ${fmtDate(m.created_date)}</span><span>👁 ${num(stat?.views)} &nbsp; ♥ ${num(stat?.likes)}</span></div>
          <div class="material-topic">${esc(m.topic||'Без темы')}</div>
          ${pubButton?`<div class="material-publication-summary">${pubButton}</div>`:''}
          <div class="card-actions material-actions">
            ${m.files_url?`<a class="small-btn action-link" target="_blank" rel="noopener" href="${esc(m.files_url)}">📁 Файлы</a>`:''}
            ${m.live_url?`<a class="small-btn action-link" target="_blank" rel="noopener" href="${esc(m.live_url)}">🌐 Онлайн</a>`:''}
            <button class="small-btn" data-edit-material="${esc(m.id)}">✎ Изменить</button>
            <button class="small-btn danger-btn" data-delete-material="${esc(m.id)}">🗑 Удалить</button>
          </div>
        </div>
      </article>`;
    }).join('')||'<div class="section-intro">Ничего не найдено.</div>';
    $$('#materialsCards .material-cover img').forEach(img=>img.addEventListener('error',()=>{img.src='assets/brand-logo.png'},{once:true}));
    $$('[data-material-publications]').forEach(b=>b.onclick=()=>openMaterialPublicationsModal(b.dataset.materialPublications));
    $$('[data-edit-material]').forEach(b=>b.onclick=()=>openMaterialModal(state.materials.find(x=>x.id===b.dataset.editMaterial)));
    $$('[data-delete-material]').forEach(b=>b.onclick=()=>{const m=state.materials.find(x=>x.id===b.dataset.deleteMaterial);deleteRecord('materials',b.dataset.deleteMaterial,`материал «${m?.title||'без названия'}» и связанные с ним публикации/статистику`,m?.cover_url)});
  }

  function renderPlan(){
    const items=[]; state.materials.filter(m=>m.planned_publish_date).forEach(m=>items.push({date:m.planned_publish_date,title:m.title,type:'Материал',status:m.status})); state.publications.filter(p=>p.publication_date).forEach(p=>{const m=state.materials.find(x=>x.id===p.material_id);items.push({date:p.publication_date,title:m?.title||'Публикация',type:`Публикация · ${p.platform.toUpperCase()}`,status:p.status})}); items.sort((a,b)=>a.date.localeCompare(b.date));
    $('#planList').innerHTML=items.map(x=>`<div class="timeline-item"><div class="timeline-date">${fmtDate(x.date)}</div><div><strong>${esc(x.title)}</strong><div class="meta">${esc(x.type)}</div></div><span class="badge ${esc(x.status)}">${esc(label(x.status))}</span></div>`).join('')||'<div class="section-intro">План пока пуст.</div>';
  }

  function latestStat(pubId){ return [...state.postStats].filter(s=>s.publication_id===pubId).sort((a,b)=>(b.snapshot_date||'').localeCompare(a.snapshot_date||''))[0]; }
  function renderPublications(){
    $('#publicationsList').innerHTML=[...state.publications].sort((a,b)=>(b.publication_date||'').localeCompare(a.publication_date||'')).map(p=>{
      const m=state.materials.find(x=>x.id===p.material_id),s=latestStat(p.id);
      const removedLine=p.status==='removed'&&p.removed_at?`<div class="meta removed-date">Снято ${fmtDate(p.removed_at)}</div>`:'';
      const lifecycleAction=p.status==='published'
        ? `<button class="small-btn remove-pub-btn" data-remove-pub="${esc(p.id)}">↓ Снять</button>`
        : `<button class="small-btn danger-btn" data-delete-pub="${esc(p.id)}">🗑 Удалить запись</button>`;
      return `<article class="publication-card card-lift ${p.status==='removed'?'publication-removed':''}">
        <div class="publication-main"><img class="publication-thumb" src="${esc(materialCover(m))}" alt=""><div><h3>${esc(m?.title||'Материал')}</h3><div class="meta">${esc(platformLabel(p.platform))} · ${fmtDate(p.publication_date)}</div>${removedLine}</div></div>
        <span class="badge ${esc(p.status)}">${esc(label(p.status))}</span>
        <div class="publication-stats"><span>👁 ${num(s?.views)}</span><span>♥ ${num(s?.likes)}</span><span>💬 ${num(s?.comments)}</span><span>↻ ${num(s?.reposts)}</span><small>${s?`замер ${fmtDate(s.snapshot_date)}`:'статистики пока нет'}</small></div>
        <div class="publication-links">${p.post_url?`<a class="small-btn action-link" target="_blank" rel="noopener" href="${esc(p.post_url)}">Открыть пост ↗</a>`:'<span class="meta">Ссылка не добавлена</span>'}<div class="card-actions"><button class="small-btn" data-stat-pub="${esc(p.id)}">＋ Статистика</button><button class="small-btn" data-edit-pub="${esc(p.id)}">✎ Изменить</button>${lifecycleAction}</div></div>
      </article>`;
    }).join('')||'<div class="section-intro">Публикаций пока нет.</div>';
    $$('#publicationsList .publication-thumb').forEach(img=>img.addEventListener('error',()=>{img.src='assets/brand-logo.png'},{once:true}));
    $$('[data-stat-pub]').forEach(b=>b.onclick=()=>openPostStatModal(state.publications.find(x=>x.id===b.dataset.statPub)));
    $$('[data-edit-pub]').forEach(b=>b.onclick=()=>openPublicationModal(state.publications.find(x=>x.id===b.dataset.editPub)));
    $$('[data-remove-pub]').forEach(b=>b.onclick=()=>markPublicationRemoved(b.dataset.removePub));
    $$('[data-delete-pub]').forEach(b=>b.onclick=()=>{const p=state.publications.find(x=>x.id===b.dataset.deletePub),m=state.materials.find(x=>x.id===p?.material_id);deleteRecord('publications',b.dataset.deletePub,`запись публикации «${m?.title||'без названия'}» вместе с её сохранённой статистикой`)});
  }

  function renderAnalytics(){
    const latestByPub=state.publications.map(p=>latestStat(p.id)).filter(Boolean), views=latestByPub.reduce((s,x)=>s+(x.views||0),0), likes=latestByPub.reduce((s,x)=>s+(x.likes||0),0), comments=latestByPub.reduce((s,x)=>s+(x.comments||0),0), reposts=latestByPub.reduce((s,x)=>s+(x.reposts||0),0);
    $('#analyticsKpis').innerHTML=[['👁','Просмотры',views],['♥','Лайки',likes],['●','Комментарии',comments],['↗','Репосты',reposts]].map(([i,t,v])=>`<article class="kpi"><div class="icon">${i}</div><h3>${t}</h3><strong>${num(v)}</strong><small>по последним замерам</small></article>`).join(''); drawViewsChart();
    const a=[...state.audience].sort((x,y)=>(y.snapshot_date||'').localeCompare(x.snapshot_date||''))[0]; $('#audienceSummary').innerHTML=a?`<div><div class="meta">${fmtDate(a.snapshot_date)} · ${esc(a.platform.toUpperCase())}</div><div class="audience-number ${(a.net_change||0)>=0?'positive':'negative'}">${(a.net_change||0)>0?'+':''}${num(a.net_change)}</div><div class="meta">${num(a.joined)} подписались · ${num(a.left_count)} отписались</div><div style="margin-top:10px"><strong>${num(a.total_members)}</strong> участников всего</div></div>`:'<div class="meta">Нет данных</div>';
    const ranks=latestByPub.map(s=>{const p=state.publications.find(x=>x.id===s.publication_id),m=p&&state.materials.find(x=>x.id===p.material_id);return {title:m?.title||'Публикация',likes:s.likes||0,views:s.views||0}}).sort((a,b)=>b.likes-a.likes); $('#topPosts').innerHTML=ranks.map((r,i)=>`<div class="rank-item"><div class="rank-no">${i+1}</div><strong>${esc(r.title)}</strong><span>♥ ${num(r.likes)}</span><span>👁 ${num(r.views)}</span></div>`).join('')||'<div class="meta">Нет статистики</div>';
  }
  function drawViewsChart(){ const c=$('#viewsChart'); if(!c)return; const ctx=c.getContext('2d'); const dpr=window.devicePixelRatio||1; const w=c.clientWidth||900,h=300;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const data=[...state.postStats].sort((a,b)=>(a.snapshot_date||'').localeCompare(b.snapshot_date||''));ctx.strokeStyle='#d9dfe8';ctx.lineWidth=1;for(let i=0;i<5;i++){const y=30+i*(h-60)/4;ctx.beginPath();ctx.moveTo(45,y);ctx.lineTo(w-20,y);ctx.stroke()}if(!data.length)return;const max=Math.max(...data.map(x=>x.views||0),1);ctx.strokeStyle='#0d448f';ctx.lineWidth=3;ctx.beginPath();data.forEach((x,i)=>{const px=50+(w-90)*(i/(Math.max(1,data.length-1))),py=h-35-(h-75)*(x.views/max);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke();ctx.fillStyle='#d5a43a';data.forEach((x,i)=>{const px=50+(w-90)*(i/(Math.max(1,data.length-1))),py=h-35-(h-75)*(x.views/max);ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fill()}); }

  function renderIdeas(){
    $('#ideasGrid').innerHTML=state.ideas.map(i=>`<article class="idea-card card-lift"><div class="meta">${esc(i.level||'—')} · ${esc(i.topic||'Без темы')}</div><h3>${esc(i.title)}</h3><div class="chip-row"><span class="chip">${esc(label(i.material_type))}</span><span class="chip ${i.priority==='high'?'priority-high':''}">Приоритет: ${esc(label(i.priority))}</span></div><span class="badge ${esc(i.status)}">${esc(label(i.status))}</span><p class="meta">${esc(i.notes||'')}</p><div class="card-actions"><button class="small-btn" data-edit-idea="${esc(i.id)}">✎ Изменить</button><button class="small-btn danger-btn" data-delete-idea="${esc(i.id)}">🗑 Удалить</button></div></article>`).join('')||'<div class="section-intro">Банк идей пока пуст.</div>';
    $$('[data-edit-idea]').forEach(b=>b.onclick=()=>openIdeaModal(state.ideas.find(x=>x.id===b.dataset.editIdea)));
    $$('[data-delete-idea]').forEach(b=>b.onclick=()=>{const i=state.ideas.find(x=>x.id===b.dataset.deleteIdea);deleteRecord('ideas',b.dataset.deleteIdea,`идею «${i?.title||'без названия'}»`)});
  }
  function renderResources(){
    $('#resourcesGrid').innerHTML=state.resources.map(r=>`<article class="resource-card card-lift"><div class="resource-icon">${r.is_favorite?'★':'⌘'}</div><div class="meta">${esc(label(r.category))}</div><h3>${esc(r.title)}</h3><p class="meta">${esc(r.description||'')}</p>${r.url?`<a target="_blank" rel="noopener" href="${esc(r.url)}">Открыть ресурс ↗</a>`:''}<div class="card-actions"><button class="small-btn" data-edit-resource="${esc(r.id)}">✎ Изменить</button><button class="small-btn danger-btn" data-delete-resource="${esc(r.id)}">🗑 Удалить</button></div></article>`).join('')||'<div class="section-intro">Ресурсов пока нет.</div>';
    $$('[data-edit-resource]').forEach(b=>b.onclick=()=>openResourceModal(state.resources.find(x=>x.id===b.dataset.editResource)));
    $$('[data-delete-resource]').forEach(b=>b.onclick=()=>{const r=state.resources.find(x=>x.id===b.dataset.deleteResource);deleteRecord('resources',b.dataset.deleteResource,`ресурс «${r?.title||'без названия'}»`)});
  }

  function showPage(page){ state.currentPage=page; $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`)); $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); const titles={dashboard:'Главная',materials:'Материалы',plan:'Контент-план',publications:'Публикации',analytics:'Аналитика',ideas:'Банк идей',resources:'Ресурсы'}; $('#pageTitle').textContent=titles[page]||'Content Studio Tracker'; if(page==='analytics')setTimeout(drawViewsChart,30); }

  function openModal(title,html){ $('#modalTitle').textContent=title; $('#modalBody').innerHTML=html; $('#modalBackdrop').classList.remove('hidden'); $('#modal').classList.remove('hidden'); }
  function closeModal(){ $('#modalBackdrop').classList.add('hidden'); $('#modal').classList.add('hidden'); }

  const levels=['A0','A0-A1','A1','A1-A2','A2','A2-B1','B1','B1-B2','B2','Mixed'];
  const types=['worksheet','reading_pack','vocabulary_pack','grammar_pack','phonics','speaking','listening','writing','test','olympiad','poster_cards','interactive_game','presentation','video_lesson','culture_corner','holiday_pack','other'];
  const statuses=['idea','in_progress','review','ready','scheduled','published','archived']; const formats=['pdf','pptx','docx','html']; const skills=['reading','vocabulary','grammar','listening','speaking','writing','phonics','culture'];
  function options(arr,current=''){return arr.map(v=>`<option value="${v}" ${v===current?'selected':''}>${esc(label(v))}</option>`).join('')}
  function choices(name,arr,selected=[]){return `<div class="choice-group">${arr.map(v=>`<label class="choice"><input type="checkbox" name="${name}" value="${v}" ${selected.includes(v)?'checked':''}>${esc(v.toUpperCase())}</label>`).join('')}</div>`}

  async function submitOnce(form, action){
    const btn=form.querySelector('button[type="submit"]');
    if(btn?.disabled) return;
    const old=btn?.textContent||'Сохранить';
    if(btn){btn.disabled=true;btn.textContent='Сохраняю…';}
    try{
      const ok=await action();
      if(ok!==false) closeModal();
    }finally{
      if(btn && document.body.contains(btn)){btn.disabled=false;btn.textContent=old;}
    }
  }

  function openMaterialModal(m=null){
    openModal(m?'Изменить материал':'Новый материал',`<form id="materialForm"><div class="form-grid">
      <div class="field full"><label>Название *</label><input name="title" required value="${esc(m?.title||'')}"></div>
      <div class="field full cover-upload-field"><label>Обложка / аватарка материала</label><div class="cover-upload-row"><div class="cover-preview"><img id="coverPreview" src="${esc(materialCover(m))}" alt="Предпросмотр обложки"></div><div><input id="coverFile" type="file" name="cover_file" accept="image/png,image/jpeg,image/webp"><p class="field-hint">PNG, JPG или WEBP · до 6 МБ. Если материал уже имеет обложку, новый файл заменит её.</p></div></div></div>
      <div class="field"><label>Уровень</label><select name="level"><option value="">—</option>${options(levels,m?.level)}</select></div>
      <div class="field"><label>Возраст</label><input name="age_group" placeholder="например 8-9" value="${esc(m?.age_group||'')}"></div>
      <div class="field"><label>Тип материала</label><select name="material_type">${options(types,m?.material_type||'worksheet')}</select></div>
      <div class="field"><label>Статус</label><select name="status">${options(statuses,m?.status||'idea')}</select></div>
      <div class="field full"><label>Форматы</label>${choices('formats',formats,m?.formats||[])}</div>
      <div class="field full"><label>Навыки</label>${choices('skills',skills,m?.skills||[])}</div>
      <div class="field"><label>Тема</label><input name="topic" value="${esc(m?.topic||'')}"></div>
      <div class="field"><label>Дата создания</label><input type="date" name="created_date" value="${esc(m?.created_date||new Date().toISOString().slice(0,10))}"></div>
      <div class="field"><label>План публикации</label><input type="date" name="planned_publish_date" value="${esc(m?.planned_publish_date||'')}"></div>
      <div class="field"><label>Ссылка на файлы</label><input type="url" name="files_url" placeholder="Например, папка на Яндекс Диске" value="${esc(m?.files_url||'')}"></div>
      <div class="field full"><label>Онлайн-версия</label><input type="url" name="live_url" placeholder="Например, игра на GitHub Pages" value="${esc(m?.live_url||'')}"></div>
      <div class="field full"><label>Заметки</label><textarea name="notes">${esc(m?.notes||'')}</textarea></div>
      </div><div class="modal-actions"><button type="button" class="btn ghost" id="cancelModal">Отмена</button><button type="submit" class="btn primary">Сохранить</button></div></form>`);
    $('#cancelModal').onclick=closeModal;
    const fileInput=$('#coverFile'),preview=$('#coverPreview');
    fileInput.onchange=()=>{const f=fileInput.files?.[0];if(f)preview.src=URL.createObjectURL(f)};
    $('#materialForm').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;submitOnce(form,async()=>{
      const f=new FormData(form),file=f.get('cover_file');
      let newCover=null;
      if(file&&file.size){ try{newCover=await uploadMaterialCover(file)}catch(err){toast('Ошибка загрузки обложки: '+err.message);return false;} }
      const rec={title:f.get('title'),level:f.get('level')||null,age_group:f.get('age_group')||null,material_type:f.get('material_type'),formats:f.getAll('formats'),topic:f.get('topic')||null,skills:f.getAll('skills'),status:f.get('status'),created_date:f.get('created_date')||new Date().toISOString().slice(0,10),planned_publish_date:f.get('planned_publish_date')||null,files_url:f.get('files_url')||null,live_url:f.get('live_url')||null,notes:f.get('notes')||null};
      if(newCover) rec.cover_url=newCover;
      const ok=await saveRecord('materials',rec,m?.id);
      if(ok&&newCover&&m?.cover_url&&m.cover_url!==newCover) await removeStoredCover(m.cover_url);
      return ok;
    });};
  }

  function openPublicationModal(p=null){
    const today=new Date().toISOString().slice(0,10);
    openModal(p?'Изменить публикацию':'Новая публикация',`<form id="pubForm">
      <div class="section-intro"><p><strong>Новый пост / новая ссылка</strong> — создайте новую публикацию. Если вы вернули тот же самый пост по той же ссылке, откройте старую запись и снова выберите «Опубликовано».</p></div>
      <div class="form-grid">
        <div class="field full"><label>Материал *</label><select name="material_id" required><option value="">Выберите материал</option>${state.materials.map(m=>`<option value="${m.id}" ${m.id===p?.material_id?'selected':''}>${esc(m.title)}</option>`).join('')}</select></div>
        <div class="field"><label>Площадка</label><select name="platform"><option value="vk" ${p?.platform==='vk'?'selected':''}>VK</option><option value="telegram" ${p?.platform==='telegram'?'selected':''}>Telegram</option><option value="github_pages" ${p?.platform==='github_pages'?'selected':''}>GitHub Pages</option><option value="website" ${p?.platform==='website'?'selected':''}>Сайт</option><option value="other" ${p?.platform==='other'?'selected':''}>Другое</option></select></div>
        <div class="field"><label>Статус</label><select id="publicationStatus" name="status"><option value="scheduled" ${(!p||p.status==='scheduled')?'selected':''}>Запланировано</option><option value="published" ${p?.status==='published'?'selected':''}>Опубликовано</option><option value="removed" ${p?.status==='removed'?'selected':''}>Снято</option><option value="draft" ${p?.status==='draft'?'selected':''}>Черновик</option></select></div>
        <div class="field"><label>Дата публикации</label><input type="date" name="publication_date" value="${esc(p?.publication_date||'')}"></div>
        <div class="field"><label>Дата снятия</label><input id="removedAtInput" type="date" name="removed_at" value="${esc(p?.removed_at||'')}"><div class="field-hint">Нужна только для статуса «Снято».</div></div>
        <div class="field full"><label>Ссылка на пост</label><input type="url" name="post_url" value="${esc(p?.post_url||'')}"></div>
        <div class="field full"><label>Заметки</label><textarea name="notes">${esc(p?.notes||'')}</textarea></div>
      </div>
      <div class="modal-actions"><button type="button" class="btn ghost" id="cancelModal">Отмена</button><button type="submit" class="btn primary">Сохранить</button></div>
    </form>`);
    $('#cancelModal').onclick=closeModal;
    const statusSelect=$('#publicationStatus'),removedInput=$('#removedAtInput');
    statusSelect.onchange=()=>{if(statusSelect.value==='removed'&&!removedInput.value)removedInput.value=today;};
    $('#pubForm').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;submitOnce(form,async()=>{
      const f=new FormData(form),status=f.get('status');
      const rec={material_id:f.get('material_id'),platform:f.get('platform'),publication_date:f.get('publication_date')||null,post_url:f.get('post_url')||null,status,removed_at:status==='removed'?(f.get('removed_at')||today):null,notes:f.get('notes')||null};
      return await saveRecord('publications',rec,p?.id);
    });};
  }

  function openMaterialPublicationsModal(materialId){
    const m=state.materials.find(x=>x.id===materialId), history=publicationHistory(materialId);
    if(!m||!history.length)return;
    const rows=history.map(p=>{
      const s=latestStat(p.id);
      return `<div class="publication-history-row ${p.status==='removed'?'is-removed':''}">
        <div class="publication-history-main"><strong>${esc(platformLabel(p.platform))}</strong><span class="badge ${esc(p.status)}">${esc(label(p.status))}</span></div>
        <div class="meta">Опубликовано: ${fmtDate(p.publication_date)}${p.status==='removed'&&p.removed_at?` · Снято: ${fmtDate(p.removed_at)}`:''}</div>
        <div class="publication-history-stats">👁 ${num(s?.views)} &nbsp; ♥ ${num(s?.likes)} &nbsp; 💬 ${num(s?.comments)} &nbsp; ↻ ${num(s?.reposts)}</div>
        ${p.post_url?`<a class="small-btn action-link" target="_blank" rel="noopener" href="${esc(p.post_url)}">Открыть публикацию ↗</a>`:'<span class="meta">Ссылка не добавлена</span>'}
      </div>`;
    }).join('');
    openModal(`Публикации — ${m.title}`,`<div class="publication-history-list">${rows}</div><div class="modal-actions"><button class="btn primary" id="historyOk">Закрыть</button></div>`);
    $('#historyOk').onclick=closeModal;
  }

  async function markPublicationRemoved(id){
    const p=state.publications.find(x=>x.id===id),m=state.materials.find(x=>x.id===p?.material_id);
    if(!p)return false;
    if(!confirm(`Снять публикацию «${m?.title||'без названия'}»? Запись, ссылка и вся накопленная статистика сохранятся в истории.`))return false;
    return await saveRecord('publications',{status:'removed',removed_at:new Date().toISOString().slice(0,10)},id);
  }

  function openPostStatModal(p){
    if(!p)return;
    const m=state.materials.find(x=>x.id===p.material_id), last=latestStat(p.id), today=new Date().toISOString().slice(0,10);
    openModal(`Статистика — ${m?.title||'публикация'}`,`<form id="statForm"><div class="section-intro"><p>Если замер на выбранную дату уже существует, он будет обновлён, а не продублирован.</p></div><div class="form-grid"><div class="field full"><label>Дата замера</label><input type="date" name="snapshot_date" required value="${today}"></div><div class="field"><label>Просмотры</label><input type="number" min="0" name="views" value="${Number(last?.views||0)}"></div><div class="field"><label>Лайки</label><input type="number" min="0" name="likes" value="${Number(last?.likes||0)}"></div><div class="field"><label>Комментарии</label><input type="number" min="0" name="comments" value="${Number(last?.comments||0)}"></div><div class="field"><label>Репосты</label><input type="number" min="0" name="reposts" value="${Number(last?.reposts||0)}"></div></div><div class="modal-actions"><button type="button" class="btn ghost" id="cancelModal">Отмена</button><button type="submit" class="btn primary">Сохранить статистику</button></div></form>`);
    $('#cancelModal').onclick=closeModal;
    $('#statForm').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;submitOnce(form,async()=>{const f=new FormData(form),date=f.get('snapshot_date');const rec={publication_id:p.id,snapshot_date:date,views:Number(f.get('views')||0),likes:Number(f.get('likes')||0),comments:Number(f.get('comments')||0),reposts:Number(f.get('reposts')||0)};const existing=state.postStats.find(x=>x.publication_id===p.id&&x.snapshot_date===date);return await saveRecord('post_stats',rec,existing?.id)});};
  }

  function openAudienceModal(){
    const last=[...state.audience].sort((a,b)=>(b.snapshot_date||'').localeCompare(a.snapshot_date||''))[0], today=new Date().toISOString().slice(0,10);
    openModal('Новый замер аудитории',`<form id="audienceForm"><div class="section-intro"><p>Прирост рассчитывается базой автоматически: подписались − отписались.</p></div><div class="form-grid"><div class="field"><label>Площадка</label><select name="platform"><option value="vk">VK</option><option value="telegram">Telegram</option><option value="other">Другое</option></select></div><div class="field"><label>Дата замера</label><input type="date" name="snapshot_date" required value="${today}"></div><div class="field"><label>Всего участников</label><input type="number" min="0" name="total_members" value="${Number(last?.total_members||0)}"></div><div class="field"><label>Подписались</label><input type="number" min="0" name="joined" value="0"></div><div class="field"><label>Отписались</label><input type="number" min="0" name="left_count" value="0"></div><div class="field full"><label>Заметки</label><textarea name="notes"></textarea></div></div><div class="modal-actions"><button type="button" class="btn ghost" id="cancelModal">Отмена</button><button type="submit" class="btn primary">Сохранить замер</button></div></form>`);
    $('#cancelModal').onclick=closeModal;
    $('#audienceForm').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;submitOnce(form,async()=>{const f=new FormData(form),platform=f.get('platform'),date=f.get('snapshot_date');const rec={platform,snapshot_date:date,total_members:Number(f.get('total_members')||0),joined:Number(f.get('joined')||0),left_count:Number(f.get('left_count')||0),notes:f.get('notes')||null};const existing=state.audience.find(x=>x.platform===platform&&x.snapshot_date===date);return await saveRecord('audience_stats',rec,existing?.id)});};
  }

  function openIdeaModal(i=null){
    openModal(i?'Изменить идею':'Новая идея',`<form id="ideaForm"><div class="form-grid"><div class="field full"><label>Идея *</label><input required name="title" value="${esc(i?.title||'')}"></div><div class="field"><label>Уровень</label><select name="level"><option value="">—</option>${options(levels,i?.level)}</select></div><div class="field"><label>Тема</label><input name="topic" value="${esc(i?.topic||'')}"></div><div class="field"><label>Тип</label><select name="material_type">${options(types,i?.material_type||'interactive_game')}</select></div><div class="field"><label>Приоритет</label><select name="priority"><option value="low" ${i?.priority==='low'?'selected':''}>Низкий</option><option value="normal" ${(!i||i.priority==='normal')?'selected':''}>Обычный</option><option value="high" ${i?.priority==='high'?'selected':''}>Высокий</option></select></div><div class="field"><label>Статус</label><select name="status"><option value="new" ${(!i||i.status==='new')?'selected':''}>Новая</option><option value="planned" ${i?.status==='planned'?'selected':''}>Запланирована</option><option value="in_progress" ${i?.status==='in_progress'?'selected':''}>В работе</option><option value="converted" ${i?.status==='converted'?'selected':''}>Создан материал</option><option value="archived" ${i?.status==='archived'?'selected':''}>Архив</option></select></div><div class="field full"><label>Заметки</label><textarea name="notes">${esc(i?.notes||'')}</textarea></div></div><div class="modal-actions"><button type="button" class="btn ghost" id="cancelModal">Отмена</button><button type="submit" class="btn primary">Сохранить</button></div></form>`);
    $('#cancelModal').onclick=closeModal;
    $('#ideaForm').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;submitOnce(form,async()=>{const f=new FormData(form);return await saveRecord('ideas',{title:f.get('title'),level:f.get('level')||null,topic:f.get('topic')||null,material_type:f.get('material_type'),priority:f.get('priority'),status:f.get('status'),notes:f.get('notes')||null},i?.id)});};
  }

  function openResourceModal(r=null){
    openModal(r?'Изменить ресурс':'Новый ресурс',`<form id="resourceForm"><div class="form-grid"><div class="field full"><label>Название *</label><input required name="title" value="${esc(r?.title||'')}"></div><div class="field"><label>Категория</label><select name="category"><option value="brand" ${r?.category==='brand'?'selected':''}>Бренд</option><option value="template" ${r?.category==='template'?'selected':''}>Шаблон</option><option value="folder" ${r?.category==='folder'?'selected':''}>Папка</option><option value="service" ${r?.category==='service'?'selected':''}>Сервис</option><option value="reference" ${r?.category==='reference'?'selected':''}>Справочник</option><option value="other" ${(!r||r.category==='other')?'selected':''}>Другое</option></select></div><div class="field"><label>В избранное</label><select name="is_favorite"><option value="false" ${!r?.is_favorite?'selected':''}>Нет</option><option value="true" ${r?.is_favorite?'selected':''}>Да</option></select></div><div class="field full"><label>Ссылка</label><input type="url" name="url" value="${esc(r?.url||'')}"></div><div class="field full"><label>Описание</label><textarea name="description">${esc(r?.description||'')}</textarea></div></div><div class="modal-actions"><button type="button" class="btn ghost" id="cancelModal">Отмена</button><button type="submit" class="btn primary">Сохранить</button></div></form>`);
    $('#cancelModal').onclick=closeModal;
    $('#resourceForm').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;submitOnce(form,async()=>{const f=new FormData(form);return await saveRecord('resources',{title:f.get('title'),category:f.get('category'),url:f.get('url')||null,description:f.get('description')||null,is_favorite:f.get('is_favorite')==='true'},r?.id)});};
  }

  function syncDemoMaterialPublicationStatus(materialId){
    if(!materialId)return;
    const m=state.materials.find(x=>x.id===materialId);if(!m)return;
    const hasPublished=state.publications.some(p=>p.material_id===materialId&&p.status==='published');
    if(hasPublished)m.status='published';
    else if(m.status==='published')m.status='ready';
  }

  async function saveRecord(table,record,id=null){
    if(!client){
      const map={materials:'materials',publications:'publications',post_stats:'postStats',audience_stats:'audience',ideas:'ideas',resources:'resources'}, key=map[table];
      const old=table==='publications'&&id?state.publications.find(x=>x.id===id):null;
      if(id){const i=state[key].findIndex(x=>x.id===id);if(i>=0)state[key][i]={...state[key][i],...record};}
      else state[key].push({id:`demo-${Date.now()}`,...record, ...(table==='audience_stats'?{net_change:(record.joined||0)-(record.left_count||0)}:{})});
      if(table==='publications'){
        syncDemoMaterialPublicationStatus(old?.material_id);
        syncDemoMaterialPublicationStatus(record.material_id||old?.material_id);
      }
      renderAll();toast('Сохранено в демо-режиме');return true;
    }
    try{
      const q=id?client.from(table).update(record).eq('id',id):client.from(table).insert(record);
      const {error}=await q;if(error)throw error;await loadAll();toast('Сохранено в Supabase ✓');return true;
    }catch(e){console.error(e);toast('Ошибка сохранения: '+e.message);return false;}
  }

  async function deleteRecord(table,id,what='запись',coverUrl=null){
    if(!confirm(`Удалить ${what}? Это действие нельзя отменить.`))return false;
    if(!client){
      const map={materials:'materials',publications:'publications',post_stats:'postStats',audience_stats:'audience',ideas:'ideas',resources:'resources'},key=map[table];
      const old=table==='publications'?state.publications.find(x=>x.id===id):null;
      state[key]=state[key].filter(x=>x.id!==id);
      if(table==='publications'){
        state.postStats=state.postStats.filter(x=>x.publication_id!==id);
        syncDemoMaterialPublicationStatus(old?.material_id);
      }
      renderAll();toast('Удалено в демо-режиме');return true;
    }
    try{const {error}=await client.from(table).delete().eq('id',id);if(error)throw error;if(coverUrl)await removeStoredCover(coverUrl);await loadAll();toast('Удалено из Supabase ✓');return true;}catch(e){console.error(e);toast('Ошибка удаления: '+e.message);return false;}
  }

  function openSettings(){ openModal('Настройки подключения',`<div class="section-intro"><strong>Текущий режим:</strong> ${state.mode==='live'?'Supabase подключён':'Локальный режим'}</div><p>Для опубликованной версии GitHub Pages откройте файл <code>config.js</code> и вставьте два сохранённых значения:</p><pre style="white-space:pre-wrap;background:#f4f1e9;padding:14px;border-radius:10px">SUPABASE_URL: "https://...supabase.co"\nSUPABASE_PUBLISHABLE_KEY: "sb_publishable_..."</pre><p class="meta"><strong>Никогда</strong> не вставляйте сюда Secret key или service_role.</p><div class="modal-actions"><button class="btn primary" id="settingsOk">Понятно</button></div>`);$('#settingsOk').onclick=closeModal; }

  let appEntered=false;
  function showLogin(){
    appEntered=false;
    $('#appShell').classList.add('hidden');
    $('#loginScreen').classList.remove('hidden');
    $('#passwordInput').value='';
  }
  function enterApp(session=null){
    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    if(session?.user?.email) state.authEmail=session.user.email;
    if(!appEntered){ appEntered=true; loadAll(); }
  }
  function cleanAuthUrl(){
    if(history.replaceState) history.replaceState({},document.title,location.pathname);
    pendingAuthFlow=null;
  }
  function authErrorText(error){
    const msg=String(error?.message||'Неизвестная ошибка');
    if(/invalid login credentials/i.test(msg)) return 'Неверный email или пароль.';
    if(/email not confirmed/i.test(msg)) return 'Email ещё не подтверждён. Откройте письмо-приглашение.';
    return msg;
  }
  function openPasswordSetup(title='Задайте пароль'){
    openModal(title,`<form id="setPasswordForm"><div class="section-intro"><p>${pendingAuthFlow==='recovery'?'Введите новый пароль для вашего аккаунта.':'Приглашение подтверждено. Теперь задайте постоянный пароль для входа в Content Studio Tracker.'}</p></div><div class="form-grid"><div class="field full"><label>Новый пароль</label><input id="newAuthPassword" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="Не менее 8 символов"></div><div class="field full"><label>Повторите пароль</label><input name="password2" type="password" autocomplete="new-password" minlength="8" required placeholder="Повторите пароль"></div></div><div class="modal-actions"><button type="submit" class="btn primary">Сохранить пароль</button></div></form>`);
    const form=$('#setPasswordForm');
    form.onsubmit=e=>{e.preventDefault();submitOnce(form,async()=>{
      const f=new FormData(form),p1=String(f.get('password')||''),p2=String(f.get('password2')||'');
      if(p1.length<8){toast('Пароль должен содержать не менее 8 символов');return false;}
      if(p1!==p2){toast('Пароли не совпадают');return false;}
      const {data,error}=await client.auth.updateUser({password:p1});
      if(error){toast('Не удалось сохранить пароль: '+authErrorText(error));return false;}
      closeModal();cleanAuthUrl();toast('Пароль сохранён ✓');
      const {data:sd}=await client.auth.getSession();
      enterApp(sd?.session||null);
      return !!data?.user;
    });};
    setTimeout(()=>$('#newAuthPassword')?.focus(),50);
  }
  function openResetPassword(){
    const current=String($('#loginInput')?.value||'').trim();
    openModal('Восстановление пароля',`<form id="resetPasswordForm"><div class="section-intro"><p>Введите email вашего аккаунта. Supabase отправит защищённую ссылку для смены пароля.</p></div><div class="form-grid"><div class="field full"><label>Email</label><input type="email" name="email" required autocomplete="email" value="${esc(current)}" placeholder="Ваш email"></div></div><div class="modal-actions"><button type="button" class="btn ghost" id="cancelReset">Отмена</button><button type="submit" class="btn primary">Отправить письмо</button></div></form>`);
    $('#cancelReset').onclick=closeModal;
    const form=$('#resetPasswordForm');
    form.onsubmit=e=>{e.preventDefault();submitOnce(form,async()=>{
      const email=String(new FormData(form).get('email')||'').trim();
      const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:AUTH_REDIRECT_URL});
      if(error){toast('Не удалось отправить письмо: '+authErrorText(error));return false;}
      closeModal();toast('Письмо для восстановления отправлено ✓');return true;
    });};
  }
  async function logout(){
    if(client){
      const {error}=await client.auth.signOut({scope:'local'});
      if(error){toast('Ошибка выхода: '+authErrorText(error));return;}
    }
    showLogin();
  }
  async function handleLogin(e){
    e.preventDefault();
    if(!client){ toast('Supabase не подключён. Проверьте config.js.'); return; }
    const email=String($('#loginInput').value||'').trim(),password=$('#passwordInput').value;
    localStorage.setItem('cst_auth_remember',$('#rememberMe').checked?'1':'0');
    const btn=e.currentTarget.querySelector('button[type="submit"]'),old=btn.textContent;btn.disabled=true;btn.textContent='Входим…';
    try{
      const {data,error}=await client.auth.signInWithPassword({email,password});
      if(error) throw error;
      enterApp(data.session);toast('Добро пожаловать ✓');
    }catch(err){toast(authErrorText(err));}
    finally{btn.disabled=false;btn.textContent=old;}
  }
  function handleAuthEvent(event,session){
    if(event==='PASSWORD_RECOVERY'){ pendingAuthFlow='recovery'; setTimeout(()=>openPasswordSetup('Новый пароль'),0); return; }
    if((event==='SIGNED_IN'||event==='INITIAL_SESSION')&&session){
      if(pendingAuthFlow==='invite'||pendingAuthFlow==='recovery'){setTimeout(()=>openPasswordSetup(pendingAuthFlow==='invite'?'Задайте пароль':'Новый пароль'),0);}
      else enterApp(session);
      return;
    }
    if(event==='SIGNED_OUT') showLogin();
  }
  async function initializeAuth(){
    if(!client){showLogin();toast('Подключение Supabase не найдено. Проверьте config.js.');return;}
    client.auth.onAuthStateChange((event,session)=>handleAuthEvent(event,session));
    const {data,error}=await client.auth.getSession();
    if(error){showLogin();toast('Ошибка проверки сессии: '+authErrorText(error));return;}
    if(data?.session){
      if(pendingAuthFlow==='invite'||pendingAuthFlow==='recovery') openPasswordSetup(pendingAuthFlow==='invite'?'Задайте пароль':'Новый пароль');
      else enterApp(data.session);
    }else showLogin();
  }

  $('#loginForm').onsubmit=handleLogin;
  $('#togglePassword').onclick=()=>{$('#passwordInput').type=$('#passwordInput').type==='password'?'text':'password'};
  $('#forgotBtn').onclick=()=>client?openResetPassword():toast('Supabase не подключён.');
  $('#logoutBtn').onclick=logout; $('#refreshBtn').onclick=()=>{loadAll();toast('Данные обновлены')}; $('#settingsBtn').onclick=openSettings; $('#quickAddBtn').onclick=()=>openMaterialModal(); $('#addMaterialBtn').onclick=()=>openMaterialModal(); $('#addPublicationBtn').onclick=()=>openPublicationModal(); $('#addAudienceBtn').onclick=openAudienceModal; $('#addIdeaBtn').onclick=()=>openIdeaModal(); $('#addResourceBtn').onclick=()=>openResourceModal(); $('#modalClose').onclick=closeModal; $('#modalBackdrop').onclick=closeModal;
  $('#mainNav').onclick=e=>{const b=e.target.closest('[data-page]');if(b)showPage(b.dataset.page)}; $$('.go-page').forEach(b=>b.onclick=()=>showPage(b.dataset.go));
  $('#materialsSearch').oninput=renderMaterials; $('#materialsStatusFilter').onchange=renderMaterials; $('#materialsLevelFilter').onchange=renderMaterials; window.addEventListener('resize',()=>state.currentPage==='analytics'&&drawViewsChart());
  initializeAuth();
})();
