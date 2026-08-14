/* =========================================================
   CONTENT STUDIO TRACKER v1.8 — AUDIENCE ANALYTICS UI

   Полноценный блок «Аналитика → Прирост».
   Рабочие app.js / style.css не переписывает.
   ========================================================= */

(() => {
  'use strict';

  const CFG = window.CONTENT_STUDIO_CONFIG || {};
  const validConfig =
    /^https:\/\/.+\.supabase\.co$/i.test(CFG.SUPABASE_URL || '') &&
    /^(sb_publishable_|eyJ)/.test(CFG.SUPABASE_PUBLISHABLE_KEY || '');

  if (!window.supabase || !validConfig) return;

  const COLLECTED_SINCE_RU = '14.08.2026';

  const authStorage = {
    getItem(key) {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    },
    setItem(key, value) {
      const persist =
        localStorage.getItem('cst_auth_remember') !== '0';
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

  let currentRange = null;
  let requestSerial = 0;

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);

  function installStyles() {
    if (document.querySelector('#audienceAnalyticsStyles')) return;

    const style = document.createElement('style');
    style.id = 'audienceAnalyticsStyles';
    style.textContent = `
      #audienceSummary.audience-analytics-active >
      :not(.audience-analytics-shell){
        display:none !important;
      }

      .audience-analytics-shell{
        display:grid;
        gap:14px;
      }

      .audience-period-row{
        display:flex;
        flex-wrap:wrap;
        align-items:end;
        gap:10px;
      }

      .audience-period-field{
        display:grid;
        gap:5px;
        min-width:210px;
      }

      .audience-period-field label,
      .audience-custom-field label{
        font-size:11px;
        font-weight:800;
        letter-spacing:.06em;
        text-transform:uppercase;
        color:#617187;
      }

      .audience-period-field select,
      .audience-custom-field input{
        min-height:38px;
        border:1px solid rgba(13,52,94,.22);
        border-radius:10px;
        padding:7px 10px;
        background:#fff;
        color:#102f59;
        font:inherit;
      }

      .audience-custom-range{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
      }

      .audience-custom-field{
        display:grid;
        gap:5px;
      }

      .audience-custom-range.hidden{
        display:none !important;
      }

      .audience-kpis{
        display:grid;
        grid-template-columns:1.35fr repeat(4,minmax(110px,1fr));
        gap:10px;
      }

      .audience-kpi{
        border:1px solid rgba(13,52,94,.17);
        border-radius:14px;
        background:#fff;
        padding:13px 14px;
        min-height:84px;
        display:flex;
        flex-direction:column;
        justify-content:center;
      }

      .audience-kpi--range{
        border-color:rgba(201,155,55,.55);
      }

      .audience-kpi__label{
        font-size:11px;
        line-height:1.3;
        font-weight:800;
        text-transform:uppercase;
        letter-spacing:.055em;
        color:#718095;
      }

      .audience-kpi__value{
        margin-top:5px;
        font-size:23px;
        line-height:1.15;
        font-weight:900;
        color:#102f59;
      }

      .audience-kpi__sub{
        margin-top:3px;
        font-size:11px;
        color:#8792a1;
      }

      .audience-growth-positive{
        color:#17653a !important;
      }

      .audience-growth-negative{
        color:#9a3434 !important;
      }

      .audience-people-actions{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        padding-top:2px;
      }

      .audience-data-note{
        margin:0;
        padding:10px 12px;
        border-radius:11px;
        background:rgba(13,52,94,.055);
        font-size:12px;
        line-height:1.45;
        color:#68788e;
      }

      .audience-data-note strong{
        color:#102f59;
      }

      .audience-loading{
        min-height:100px;
        display:flex;
        align-items:center;
        justify-content:center;
        color:#718095;
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

      .audience-person-empty{
        padding:18px;
        border:1px dashed rgba(13,52,94,.25);
        border-radius:14px;
        color:#778497;
        text-align:center;
      }

      @media(max-width:1000px){
        .audience-kpis{
          grid-template-columns:repeat(2,minmax(0,1fr));
        }
        .audience-kpi--range{
          grid-column:1 / -1;
        }
      }

      @media(max-width:620px){
        .audience-kpis{
          grid-template-columns:1fr;
        }
        .audience-kpi--range{
          grid-column:auto;
        }
        .audience-period-field{
          min-width:100%;
        }
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

  function fmtNumber(value, signed = false) {
    if (value == null || !Number.isFinite(Number(value))) return '—';

    const n = Number(value);
    const text = new Intl.NumberFormat('ru-RU').format(Math.abs(n));

    if (!signed) return new Intl.NumberFormat('ru-RU').format(n);
    if (n > 0) return `+${text}`;
    if (n < 0) return `−${text}`;
    return '0';
  }

  function fmtPercent(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';

    const n = Number(value);
    const abs = Math.abs(n).toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    if (n > 0) return `+${abs}%`;
    if (n < 0) return `−${abs}%`;
    return '0,00%';
  }

  function fmtDate(date) {
    if (!date) return '—';
    const [y, m, d] = String(date).split('-');
    return `${d}.${m}.${y}`;
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

  function todayMoscow() {
    const shifted = new Date(Date.now() + 3 * 3600_000);
    return shifted.toISOString().slice(0, 10);
  }

  function ensureShell() {
    const summary = document.querySelector('#audienceSummary');
    if (!summary) return null;

    summary.classList.add('audience-analytics-active');

    let shell = summary.querySelector('.audience-analytics-shell');

    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'audience-analytics-shell';

      const today = todayMoscow();

      shell.innerHTML = `
        <div class="audience-period-row">
          <div class="audience-period-field">
            <label for="audiencePeriodSelect">Период</label>
            <select id="audiencePeriodSelect">
              <option value="7d">7 дней</option>
              <option value="30d">30 дней</option>
              <option value="90d">90 дней</option>
              <option value="this_month">Этот месяц</option>
              <option value="prev_month">Прошлый месяц</option>
              <option value="custom">Свой период</option>
            </select>
          </div>

          <div
            id="audienceCustomRange"
            class="audience-custom-range hidden"
          >
            <div class="audience-custom-field">
              <label for="audienceDateFrom">С</label>
              <input
                id="audienceDateFrom"
                type="date"
                max="${today}"
              >
            </div>

            <div class="audience-custom-field">
              <label for="audienceDateTo">По</label>
              <input
                id="audienceDateTo"
                type="date"
                max="${today}"
                value="${today}"
              >
            </div>

            <button
              id="audienceApplyCustom"
              type="button"
              class="small-btn"
            >Показать</button>
          </div>
        </div>

        <div id="audienceAnalyticsContent">
          <div class="audience-loading">Загрузка аналитики…</div>
        </div>
      `;

      summary.appendChild(shell);

      const select = shell.querySelector('#audiencePeriodSelect');
      const custom = shell.querySelector('#audienceCustomRange');
      const apply = shell.querySelector('#audienceApplyCustom');

      const saved =
        localStorage.getItem('cst_audience_period') || '7d';

      select.value = [
        '7d',
        '30d',
        '90d',
        'this_month',
        'prev_month',
        'custom'
      ].includes(saved)
        ? saved
        : '7d';

      custom.classList.toggle(
        'hidden',
        select.value !== 'custom'
      );

      select.addEventListener('change', () => {
        localStorage.setItem(
          'cst_audience_period',
          select.value
        );

        custom.classList.toggle(
          'hidden',
          select.value !== 'custom'
        );

        if (select.value !== 'custom') {
          loadSummary();
        }
      });

      apply.addEventListener('click', () => {
        loadSummary();
      });

      queueMicrotask(loadSummary);
    }

    return shell;
  }

  async function invokeAnalytics(payload) {
    const { data, error } = await client.functions.invoke(
      'vk-audience-analytics',
      { body: payload }
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
      throw new Error(
        data?.error || 'Не удалось получить аналитику аудитории.'
      );
    }

    return data;
  }

  async function invokePeople(type, range) {
    const { data, error } = await client.functions.invoke(
      'vk-audience-read',
      {
        body: {
          type,
          date_from: range.from,
          date_to: range.to,
          limit: 500
        }
      }
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
      throw new Error(
        data?.error || 'Не удалось получить список людей.'
      );
    }

    return data;
  }

  function growthClass(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    return n > 0
      ? 'audience-growth-positive'
      : 'audience-growth-negative';
  }

  function renderSummary(data) {
    const content =
      document.querySelector('#audienceAnalyticsContent');

    if (!content) return;

    currentRange = data.range;

    const partialEvents = !data.events?.complete;
    const noFullSnapshots =
      !data.totals?.snapshot_history_complete;

    const eventSuffix = partialEvents ? '*' : '';

    let note = `
      Персональные подписки и отписки собираются с
      <strong>${COLLECTED_SINCE_RU}</strong>.
    `;

    if (partialEvents) {
      note += `
        Для выбранного периода значения «Подписалось» и
        «Отписалось» показаны только с ${COLLECTED_SINCE_RU}
        и отмечены *.
      `;
    }

    if (noFullSnapshots) {
      note += `
        Полная история «Было → Стало» ещё накапливается;
        поэтому для старых периодов часть значений может быть «—».
      `;
    }

    content.innerHTML = `
      <div class="audience-kpis">
        <div class="audience-kpi audience-kpi--range">
          <div class="audience-kpi__label">Было → Стало</div>
          <div class="audience-kpi__value">
            ${fmtNumber(data.totals?.start)}
            <span aria-hidden="true">→</span>
            ${fmtNumber(data.totals?.end)}
          </div>
          <div class="audience-kpi__sub">
            ${fmtDate(data.range?.from)} — ${fmtDate(data.range?.to)}
          </div>
        </div>

        <div class="audience-kpi">
          <div class="audience-kpi__label">Подписалось</div>
          <div class="audience-kpi__value audience-growth-positive">
            +${fmtNumber(data.events?.joined)}${eventSuffix}
          </div>
        </div>

        <div class="audience-kpi">
          <div class="audience-kpi__label">Отписалось</div>
          <div class="audience-kpi__value audience-growth-negative">
            −${fmtNumber(data.events?.left)}${eventSuffix}
          </div>
        </div>

        <div class="audience-kpi">
          <div class="audience-kpi__label">Чистый прирост</div>
          <div class="audience-kpi__value ${growthClass(
            data.net_change
          )}">
            ${fmtNumber(data.net_change, true)}
          </div>
        </div>

        <div class="audience-kpi">
          <div class="audience-kpi__label">Рост</div>
          <div class="audience-kpi__value ${growthClass(
            data.growth_pct
          )}">
            ${fmtPercent(data.growth_pct)}
          </div>
        </div>
      </div>

      <div class="audience-people-actions">
        <button
          type="button"
          class="small-btn"
          data-audience-people="join"
        >Показать кто подписался</button>

        <button
          type="button"
          class="small-btn"
          data-audience-people="leave"
        >Показать кто отписался</button>
      </div>

      <p class="audience-data-note">${note}</p>
    `;
  }

  function renderError(message) {
    const content =
      document.querySelector('#audienceAnalyticsContent');

    if (!content) return;

    content.innerHTML = `
      <div class="audience-person-empty">
        Не удалось загрузить аналитику.<br>
        <span class="meta">${esc(message)}</span>
      </div>
    `;
  }

  async function loadSummary() {
    const shell = ensureShell();
    if (!shell) return;

    const content =
      shell.querySelector('#audienceAnalyticsContent');
    const select =
      shell.querySelector('#audiencePeriodSelect');

    if (!content || !select) return;

    const serial = ++requestSerial;

    content.innerHTML =
      '<div class="audience-loading">Загрузка аналитики…</div>';

    try {
      const { data: sessionData } =
        await client.auth.getSession();

      if (!sessionData?.session) {
        throw new Error('Сначала войдите в Tracker.');
      }

      const payload = {
        action: 'summary',
        period: select.value
      };

      if (select.value === 'custom') {
        const dateFrom =
          shell.querySelector('#audienceDateFrom')?.value;
        const dateTo =
          shell.querySelector('#audienceDateTo')?.value;

        if (!dateFrom || !dateTo) {
          throw new Error('Укажите обе даты периода.');
        }

        if (dateFrom > dateTo) {
          throw new Error(
            'Дата «С» не может быть позже даты «По».'
          );
        }

        payload.date_from = dateFrom;
        payload.date_to = dateTo;
      }

      const data = await invokeAnalytics(payload);

      if (serial !== requestSerial) return;
      renderSummary(data);
    } catch (error) {
      if (serial !== requestSerial) return;

      console.error('[Audience Analytics]', error);
      renderError(
        error instanceof Error ? error.message : String(error)
      );
    }
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
    const title =
      type === 'join'
        ? 'Кто подписался'
        : 'Кто отписался';

    const rows = data.items || [];

    const html = rows.length
      ? `
        <div class="section-intro compact">
          <p>
            ${fmtDate(currentRange?.from)} —
            ${fmtDate(currentRange?.to)} ·
            найдено: <strong>${rows.length}</strong>
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
                  <div class="audience-person__name">
                    ${esc(fullName)}
                  </div>

                  <div class="audience-person__meta">
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
          За выбранный период пока нет
          ${
            type === 'join'
              ? 'зафиксированных подписок'
              : 'зафиксированных отписок'
          }.
        </div>
      `;

    openModal(title, html);
  }

  async function showPeople(type, button) {
    if (!currentRange) return;

    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Загрузка…';

    try {
      const data = await invokePeople(type, currentRange);
      renderPeople(type, data);
    } catch (error) {
      console.error('[Audience People]', error);

      openModal(
        'Аудитория',
        `<div class="audience-person-empty">
          Не удалось получить список людей.<br>
          <span class="meta">${esc(
            error instanceof Error
              ? error.message
              : String(error)
          )}</span>
        </div>`
      );
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  const observer = new MutationObserver(() => {
    queueMicrotask(ensureShell);
  });

  function start() {
    installStyles();

    const summary = document.querySelector('#audienceSummary');

    if (!summary) {
      setTimeout(start, 350);
      return;
    }

    ensureShell();

    observer.observe(summary, {
      childList: true
    });
  }

  document.addEventListener('click', (event) => {
    const button =
      event.target.closest('[data-audience-people]');

    if (!button) return;

    showPeople(
      button.dataset.audiencePeople,
      button
    );
  });

  start();
})();
