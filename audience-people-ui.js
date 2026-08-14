/* =========================================================
   CONTENT STUDIO TRACKER v1.7 — AUDIENCE PEOPLE UI
   ========================================================= */

(() => {
  'use strict';

  const CFG = window.CONTENT_STUDIO_CONFIG || {};
  const validConfig =
    /^https:\/\/.+\.supabase\.co$/i.test(CFG.SUPABASE_URL || '') &&
    /^(sb_publishable_|eyJ)/.test(CFG.SUPABASE_PUBLISHABLE_KEY || '');

  if (!window.supabase || !validConfig) return;

  const COLLECTED_SINCE = '14.08.2026';

  const authStorage = {
    getItem(key) {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    },
    setItem(key, value) {
      const persist = localStorage.getItem('cst_auth_remember') !== '0';
      const target = persist ? localStorage : sessionStorage;
      const other = persist ? sessionStorage : localStorage;
      other.removeItem(key);
      target.setItem(key, value);
    },
    removeItem(key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  };

  const client = window.supabase.createClient(
    CFG.SUPABASE_URL,
    CFG.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: authStorage
      }
    }
  );

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);

  function installStyles() {
    if (document.querySelector('#audiencePeopleStyles')) return;

    const style = document.createElement('style');
    style.id = 'audiencePeopleStyles';
    style.textContent = `
      .audience-people-tools{
        margin-top:16px;
        padding-top:14px;
        border-top:1px solid rgba(13,52,94,.16);
        display:grid;
        gap:9px;
      }
      .audience-people-actions{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
      }
      .audience-people-note{
        margin:0;
        font-size:12px;
        line-height:1.45;
        color:#7b8797;
      }
      .audience-person-list{
        display:grid;
        gap:10px;
      }
      .audience-person{
        display:grid;
        grid-template-columns:46px minmax(0,1fr) auto;
        align-items:center;
        gap:12px;
        padding:11px 12px;
        border:1px solid rgba(13,52,94,.16);
        border-radius:14px;
        background:#fff;
      }
      .audience-person img{
        width:46px;
        height:46px;
        object-fit:cover;
        border-radius:50%;
        border:1px solid rgba(201,155,55,.45);
        background:#f6f3ea;
      }
      .audience-person__name{
        font-weight:800;
        color:#102f59;
        overflow-wrap:anywhere;
      }
      .audience-person__meta{
        margin-top:2px;
        color:#7a8797;
        font-size:12px;
        line-height:1.4;
      }
      .audience-person__leave{
        color:#8a6716;
      }
      .audience-person-empty{
        padding:18px;
        border:1px dashed rgba(13,52,94,.25);
        border-radius:14px;
        color:#778497;
        text-align:center;
      }
      @media(max-width:640px){
        .audience-person{
          grid-template-columns:42px minmax(0,1fr);
        }
        .audience-person .small-btn{
          grid-column:1 / -1;
          justify-self:start;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function fmtDateTime(value) {
    if (!value) return '—';

    try {
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function ensureTools() {
    const summary = document.querySelector('#audienceSummary');
    if (!summary) return;

    let tools = summary.querySelector('.audience-people-tools');

    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'audience-people-tools';
      tools.innerHTML = `
        <div class="audience-people-actions">
          <button type="button" class="small-btn" data-audience-people="join">
            Кто подписался
          </button>
          <button type="button" class="small-btn" data-audience-people="leave">
            Кто отписался
          </button>
        </div>
        <p class="audience-people-note">
          Персональный журнал доступен с ${COLLECTED_SINCE}.
          Более ранние подписки и отписки VK задним числом не передаёт.
        </p>
      `;

      summary.appendChild(tools);
    }
  }

  async function invoke(type) {
    const { data, error } = await client.functions.invoke(
      'vk-audience-read',
      { body: { type, limit: 300 } }
    );

    if (error) {
      let details = error.message || String(error);

      try {
        const extra = await error.context?.json?.();
        if (extra?.error) details = extra.error;
      } catch {}

      throw new Error(details);
    }

    if (!data?.ok) {
      throw new Error(data?.error || 'Не удалось получить события аудитории.');
    }

    return data;
  }

  function openModal(title, html) {
    const modal = document.querySelector('#modal');
    const backdrop = document.querySelector('#modalBackdrop');
    const modalTitle = document.querySelector('#modalTitle');
    const modalBody = document.querySelector('#modalBody');

    if (!modal || !backdrop || !modalTitle || !modalBody) return;

    modalTitle.textContent = title;
    modalBody.innerHTML = html;

    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
  }

  function renderPeople(type, data) {
    const title = type === 'join' ? 'Кто подписался' : 'Кто отписался';
    const rows = data.items || [];

    const html = rows.length
      ? `
        <div class="section-intro compact">
          <p>
            Найдено: <strong>${rows.length}</strong>.
            Персональные события собираются с ${COLLECTED_SINCE}.
          </p>
        </div>
        <div class="audience-person-list">
          ${rows.map((item) => {
            const fullName =
              [item.first_name, item.last_name]
                .filter(Boolean)
                .join(' ')
                .trim() || `VK ID ${item.user_id}`;

            const fallback = 'assets/brand-logo.png';

            const leaveMeta =
              type === 'leave' && item.left_self === true
                ? ' · вышел(а) самостоятельно'
                : '';

            return `
              <div class="audience-person">
                <img
                  src="${esc(item.photo_100 || fallback)}"
                  alt=""
                  onerror="this.src='${fallback}'"
                >
                <div>
                  <div class="audience-person__name">${esc(fullName)}</div>
                  <div class="audience-person__meta ${
                    type === 'leave' ? 'audience-person__leave' : ''
                  }">
                    ${esc(fmtDateTime(item.occurred_at))}
                    ${esc(leaveMeta)}
                  </div>
                </div>
                <a
                  class="small-btn action-link"
                  href="${esc(item.profile_url)}"
                  target="_blank"
                  rel="noopener"
                >Открыть VK ↗</a>
              </div>
            `;
          }).join('')}
        </div>
      `
      : `
        <div class="audience-person-empty">
          Пока нет ${
            type === 'join'
              ? 'зафиксированных новых подписок'
              : 'зафиксированных отписок'
          } с момента подключения Callback API.
        </div>
      `;

    openModal(title, html);
  }

  async function showPeople(type, button) {
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Загрузка…';

    try {
      const { data: sessionData } = await client.auth.getSession();

      if (!sessionData?.session) {
        throw new Error('Сначала войдите в Tracker.');
      }

      const data = await invoke(type);
      renderPeople(type, data);
    } catch (error) {
      console.error('[Audience People]', error);

      openModal(
        'Аудитория',
        `<div class="section-intro">
          <p>Не удалось получить журнал аудитории.</p>
          <p class="meta">${esc(
            error instanceof Error ? error.message : String(error)
          )}</p>
        </div>`
      );
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  const observer = new MutationObserver(() => {
    queueMicrotask(ensureTools);
  });

  function start() {
    installStyles();

    const summary = document.querySelector('#audienceSummary');

    if (!summary) {
      setTimeout(start, 400);
      return;
    }

    ensureTools();

    observer.observe(summary, { childList: true });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-audience-people]');
    if (!button) return;

    showPeople(button.dataset.audiencePeople, button);
  });

  start();
})();
