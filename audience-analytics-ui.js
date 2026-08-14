/* =========================================================
   CONTENT STUDIO TRACKER v1.8.2
   ЕДИНЫЙ ПЕРИОД ДЛЯ ВСЕЙ АНАЛИТИКИ

   Надстройка поверх рабочего app.js v1.5.
   app.js и style.css не меняются.
   ========================================================= */

(() => {
  'use strict';

  const CFG =
    window.CONTENT_STUDIO_CONFIG || {};

  const validConfig =
    /^https:\/\/.+\.supabase\.co$/i.test(
      CFG.SUPABASE_URL || ''
    ) &&
    /^(sb_publishable_|eyJ)/.test(
      CFG.SUPABASE_PUBLISHABLE_KEY || ''
    );

  if (!window.supabase || !validConfig) {
    console.warn(
      '[Analytics v1.8.2] Supabase config not found.'
    );
    return;
  }

  const COLLECTED_SINCE_RU =
    '14.08.2026';

  const authStorage = {
    getItem(key) {
      return (
        sessionStorage.getItem(key) ??
        localStorage.getItem(key)
      );
    },

    setItem(key, value) {
      const persist =
        localStorage.getItem(
          'cst_auth_remember'
        ) !== '0';

      const target = persist
        ? localStorage
        : sessionStorage;

      const other = persist
        ? sessionStorage
        : localStorage;

      other.removeItem(key);
      target.setItem(key, value);
    },

    removeItem(key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  };

  const client =
    window.supabase.createClient(
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

  const PERIODS = new Set([
    '7d',
    '30d',
    '90d',
    'this_month',
    'prev_month',
    'custom'
  ]);

  let currentData = null;
  let requestSerial = 0;
  let restoreTimer = null;

  const chartState = {
    data: [],
    range: null,
    bars: [],
    resizeObserver: null
  };

  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
        })[char]
    );

  function displayError(value) {
    if (value == null) return '';

    if (typeof value === 'string') {
      return value;
    }

    if (value instanceof Error) {
      return value.message;
    }

    if (typeof value === 'object') {
      if (typeof value.message === 'string') {
        return value.message;
      }

      if (typeof value.error_msg === 'string') {
        return value.error_msg;
      }

      if (
        value.error &&
        typeof value.error.error_msg === 'string'
      ) {
        return value.error.error_msg;
      }

      try {
        return JSON.stringify(value);
      } catch {}
    }

    return String(value);
  }

  function installStyles() {
    if (
      document.querySelector(
        '#analyticsPeriodStyles'
      )
    ) {
      return;
    }

    const style =
      document.createElement('style');

    style.id = 'analyticsPeriodStyles';

    style.textContent = `
      .analytics-period-toolbar{
        display:flex;
        flex-wrap:wrap;
        align-items:flex-end;
        gap:12px;
        margin:0 0 18px;
        padding:14px 16px;
        background:#fff;
        border:1px solid #e8e1d5;
        border-radius:16px;
        box-shadow:var(--soft);
      }

      .analytics-period-field,
      .analytics-custom-field{
        display:grid;
        gap:5px;
      }

      .analytics-period-field{
        min-width:240px;
      }

      .analytics-period-field label,
      .analytics-custom-field label{
        font-size:11px;
        font-weight:800;
        letter-spacing:.07em;
        text-transform:uppercase;
        color:#66758b;
      }

      .analytics-period-field select,
      .analytics-custom-field input{
        min-height:42px;
        padding:8px 12px;
        border:1px solid #d8d1c3;
        border-radius:11px;
        background:#fff;
        color:#17375f;
        font:inherit;
      }

      .analytics-custom-range{
        display:flex;
        flex-wrap:wrap;
        align-items:flex-end;
        gap:8px;
      }

      .analytics-custom-range.hidden{
        display:none !important;
      }

      .analytics-period-caption{
        margin-left:auto;
        align-self:center;
        max-width:410px;
        color:#7d8999;
        font-size:12px;
        line-height:1.45;
      }

      .analytics-period-kpi small{
        line-height:1.35;
      }

      #viewsChart{
        display:none !important;
      }

      .period-chart-host{
        position:relative;
        width:100%;
        min-height:330px;
      }

      #analyticsPeriodChart{
        display:block;
        width:100%;
        height:320px;
      }

      .period-chart-note{
        margin:8px 0 0;
        color:#8390a1;
        font-size:12px;
        line-height:1.45;
      }

      .period-chart-tooltip{
        position:absolute;
        z-index:6;
        pointer-events:none;
        min-width:150px;
        padding:9px 11px;
        border:1px solid rgba(201,155,55,.55);
        border-radius:10px;
        background:#fff;
        box-shadow:0 10px 28px rgba(9,34,74,.16);
        color:#17375f;
        font-size:12px;
        line-height:1.45;
        transform:translate(-50%,-100%);
      }

      .period-chart-tooltip.hidden{
        display:none !important;
      }

      .period-chart-tooltip strong{
        display:block;
        margin-bottom:2px;
        color:#0b2f62;
      }

      #audienceSummary.period-audience-owned{
        display:block;
        place-items:unset;
        min-height:260px;
        text-align:left;
      }

      .period-audience{
        display:grid;
        gap:12px;
      }

      .period-audience-kpis{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:9px;
      }

      .period-audience-card{
        min-width:0;
        padding:11px 12px;
        border:1px solid rgba(13,52,94,.15);
        border-radius:13px;
        background:#fff;
      }

      .period-audience-card--total{
        grid-column:1 / -1;
        border-color:rgba(201,155,55,.5);
      }

      .period-audience-label{
        color:#718095;
        font-size:10px;
        line-height:1.3;
        font-weight:800;
        letter-spacing:.055em;
        text-transform:uppercase;
      }

      .period-audience-value{
        margin-top:4px;
        color:#102f59;
        font:700 22px Georgia,serif;
        line-height:1.2;
      }

      .period-audience-card--total
      .period-audience-value{
        font-size:27px;
      }

      .period-positive{
        color:#197351 !important;
      }

      .period-negative{
        color:#a53b3b !important;
      }

      .period-audience-actions{
        display:flex;
        flex-wrap:wrap;
        gap:7px;
      }

      .period-data-note{
        margin:0;
        padding:9px 10px;
        border-radius:10px;
        background:rgba(13,52,94,.05);
        color:#6f7e91;
        font-size:11px;
        line-height:1.45;
      }

      .period-data-note strong{
        color:#17375f;
      }

      .period-error-note{
        margin:0;
        padding:9px 10px;
        border:1px solid rgba(165,59,59,.2);
        border-radius:10px;
        background:rgba(165,59,59,.045);
        color:#8a4c4c;
        font-size:11px;
        line-height:1.4;
      }

      .period-loading,
      .period-empty{
        min-height:120px;
        display:grid;
        place-items:center;
        text-align:center;
        color:#7e8b9d;
      }

      .period-person-list{
        display:grid;
        gap:10px;
      }

      .period-person{
        display:grid;
        grid-template-columns:46px minmax(0,1fr) auto;
        align-items:center;
        gap:12px;
        padding:11px 12px;
        border:1px solid rgba(13,52,94,.16);
        border-radius:14px;
        background:#fff;
      }

      .period-person img{
        width:46px;
        height:46px;
        object-fit:cover;
        border-radius:50%;
        border:1px solid rgba(201,155,55,.45);
        background:#f6f3ea;
      }

      .period-person__name{
        color:#102f59;
        font-weight:800;
        overflow-wrap:anywhere;
      }

      .period-person__meta{
        margin-top:2px;
        color:#7a8797;
        font-size:12px;
        line-height:1.4;
      }

      @media(max-width:900px){
        .analytics-period-caption{
          flex-basis:100%;
          margin-left:0;
        }
      }

      @media(max-width:620px){
        .analytics-period-field{
          min-width:100%;
        }

        .analytics-custom-range{
          width:100%;
        }

        .period-person{
          grid-template-columns:42px minmax(0,1fr);
        }

        .period-person .small-btn{
          grid-column:1 / -1;
          justify-self:start;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function fmtNumber(
    value,
    signed = false
  ) {
    if (
      value == null ||
      !Number.isFinite(Number(value))
    ) {
      return '—';
    }

    const n = Number(value);

    if (!signed) {
      return new Intl.NumberFormat(
        'ru-RU'
      ).format(n);
    }

    const abs =
      new Intl.NumberFormat(
        'ru-RU'
      ).format(Math.abs(n));

    if (n > 0) return `+${abs}`;
    if (n < 0) return `−${abs}`;
    return '0';
  }

  function fmtCompact(value) {
    const n = Number(value || 0);

    if (n >= 1_000_000) {
      return (
        (n / 1_000_000)
          .toLocaleString('ru-RU', {
            maximumFractionDigits: 1
          }) + ' млн'
      );
    }

    if (n >= 1_000) {
      return (
        (n / 1_000)
          .toLocaleString('ru-RU', {
            maximumFractionDigits: 1
          }) + ' тыс.'
      );
    }

    return fmtNumber(n);
  }

  function fmtPercent(value) {
    if (
      value == null ||
      !Number.isFinite(Number(value))
    ) {
      return '—';
    }

    const n = Number(value);

    const abs =
      Math.abs(n).toLocaleString(
        'ru-RU',
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      );

    if (n > 0) return `+${abs}%`;
    if (n < 0) return `−${abs}%`;
    return '0,00%';
  }

  function fmtDate(date) {
    if (!date) return '—';

    const [y, m, d] =
      String(date).split('-');

    return `${d}.${m}.${y}`;
  }

  function fmtShortDate(date) {
    if (!date) return '';

    const [y, m, d] =
      String(date).split('-');

    return `${d}.${m}`;
  }

  function fmtDateTime(value) {
    if (!value) return '—';

    try {
      return new Intl.DateTimeFormat(
        'ru-RU',
        {
          timeZone: 'Europe/Moscow',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }
      ).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function signClass(value) {
    const n = Number(value);

    if (
      !Number.isFinite(n) ||
      n === 0
    ) {
      return '';
    }

    return n > 0
      ? 'period-positive'
      : 'period-negative';
  }

  function isoDayNumber(date) {
    const [y, m, d] =
      String(date)
        .split('-')
        .map(Number);

    return Math.floor(
      Date.UTC(y, m - 1, d) /
        86_400_000
    );
  }

  function dateFromDayNumber(day) {
    return new Date(
      day * 86_400_000
    )
      .toISOString()
      .slice(0, 10);
  }

  function todayMoscow() {
    return new Date(
      Date.now() + 3 * 3600_000
    )
      .toISOString()
      .slice(0, 10);
  }

  function ensureToolbar() {
    const page =
      document.querySelector(
        '#page-analytics'
      );

    const kpis =
      document.querySelector(
        '#analyticsKpis'
      );

    if (!page || !kpis) return null;

    let toolbar =
      page.querySelector(
        '.analytics-period-toolbar'
      );

    if (toolbar) return toolbar;

    const today = todayMoscow();

    toolbar =
      document.createElement('div');

    toolbar.className =
      'analytics-period-toolbar';

    toolbar.innerHTML = `
      <div class="analytics-period-field">
        <label for="analyticsPeriodSelect">
          Период аналитики
        </label>

        <select id="analyticsPeriodSelect">
          <option value="7d">7 дней</option>
          <option value="30d">30 дней</option>
          <option value="90d">90 дней</option>
          <option value="this_month">
            Этот месяц
          </option>
          <option value="prev_month">
            Прошлый месяц
          </option>
          <option value="custom">
            Свой период
          </option>
        </select>
      </div>

      <div
        id="analyticsCustomRange"
        class="analytics-custom-range hidden"
      >
        <div class="analytics-custom-field">
          <label for="analyticsDateFrom">
            С
          </label>
          <input
            id="analyticsDateFrom"
            type="date"
            max="${today}"
          >
        </div>

        <div class="analytics-custom-field">
          <label for="analyticsDateTo">
            По
          </label>
          <input
            id="analyticsDateTo"
            type="date"
            max="${today}"
            value="${today}"
          >
        </div>

        <button
          id="analyticsApplyCustom"
          type="button"
          class="small-btn"
        >
          Показать
        </button>
      </div>

      <div class="analytics-period-caption">
        Один период применяется к постам,
        графику, лидерам и приросту аудитории.
      </div>
    `;

    page.insertBefore(
      toolbar,
      kpis
    );

    const select =
      toolbar.querySelector(
        '#analyticsPeriodSelect'
      );

    const custom =
      toolbar.querySelector(
        '#analyticsCustomRange'
      );

    const apply =
      toolbar.querySelector(
        '#analyticsApplyCustom'
      );

    const saved =
      localStorage.getItem(
        'cst_analytics_period'
      );

    select.value =
      PERIODS.has(saved)
        ? saved
        : 'this_month';

    custom.classList.toggle(
      'hidden',
      select.value !== 'custom'
    );

    select.addEventListener(
      'change',
      () => {
        localStorage.setItem(
          'cst_analytics_period',
          select.value
        );

        custom.classList.toggle(
          'hidden',
          select.value !== 'custom'
        );

        if (
          select.value !== 'custom'
        ) {
          refreshAnalytics();
        }
      }
    );

    apply.addEventListener(
      'click',
      refreshAnalytics
    );

    return toolbar;
  }

  function ensureChartHost() {
    const original =
      document.querySelector(
        '#viewsChart'
      );

    if (!original) return null;

    const panel =
      original.closest('.panel');

    if (!panel) return null;

    const title =
      panel.querySelector(
        '.panel-head h2'
      );

    if (title) {
      title.textContent =
        'Просмотры публикаций по датам выхода';
    }

    let host =
      panel.querySelector(
        '.period-chart-host'
      );

    if (!host) {
      host =
        document.createElement('div');

      host.className =
        'period-chart-host';

      host.innerHTML = `
        <canvas
          id="analyticsPeriodChart"
          width="900"
          height="320"
        ></canvas>

        <div
          id="analyticsChartTooltip"
          class="period-chart-tooltip hidden"
        ></div>

        <p class="period-chart-note">
          Показаны текущие просмотры
          публикаций, вышедших в выбранный
          период — по их последнему замеру.
        </p>
      `;

      original.insertAdjacentElement(
        'afterend',
        host
      );

      const canvas =
        host.querySelector(
          '#analyticsPeriodChart'
        );

      canvas.addEventListener(
        'mousemove',
        handleChartMouseMove
      );

      canvas.addEventListener(
        'mouseleave',
        hideChartTooltip
      );

      if (
        'ResizeObserver' in window
      ) {
        chartState.resizeObserver =
          new ResizeObserver(() => {
            requestAnimationFrame(
              drawPeriodChart
            );
          });

        chartState.resizeObserver.observe(
          host
        );
      }
    }

    return host;
  }

  async function invokeAnalytics(
    payload
  ) {
    const { data, error } =
      await client.functions.invoke(
        'vk-audience-analytics',
        { body: payload }
      );

    if (error) {
      let details =
        error.message ||
        String(error);

      try {
        const extra =
          await error.context
            ?.json?.();

        if (extra?.error) {
          details = extra.error;
        }
      } catch {}

      throw new Error(details);
    }

    if (!data?.ok) {
      throw new Error(
        data?.error ||
        'Не удалось получить аналитику.'
      );
    }

    return data;
  }

  async function invokePeople(
    type,
    range
  ) {
    const { data, error } =
      await client.functions.invoke(
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
      let details =
        error.message ||
        String(error);

      try {
        const extra =
          await error.context
            ?.json?.();

        if (extra?.error) {
          details = extra.error;
        }
      } catch {}

      throw new Error(details);
    }

    if (!data?.ok) {
      throw new Error(
        data?.error ||
        'Не удалось получить список людей.'
      );
    }

    return data;
  }

  function buildPayload() {
    const toolbar =
      ensureToolbar();

    const select =
      toolbar?.querySelector(
        '#analyticsPeriodSelect'
      );

    if (!select) {
      throw new Error(
        'Не найден выбор периода.'
      );
    }

    const payload = {
      action: 'summary',
      period: select.value
    };

    if (
      select.value === 'custom'
    ) {
      const from =
        toolbar.querySelector(
          '#analyticsDateFrom'
        )?.value;

      const to =
        toolbar.querySelector(
          '#analyticsDateTo'
        )?.value;

      if (!from || !to) {
        throw new Error(
          'Укажите обе даты периода.'
        );
      }

      if (from > to) {
        throw new Error(
          'Дата «С» не может быть позже даты «По».'
        );
      }

      payload.date_from = from;
      payload.date_to = to;
    }

    return payload;
  }

  function renderPostKpis(data) {
    const container =
      document.querySelector(
        '#analyticsKpis'
      );

    if (!container) return;

    const totals =
      data.posts?.totals || {};

    const count =
      Number(data.posts?.count || 0);

    const rangeText =
      `${fmtDate(data.range?.from)} — ` +
      `${fmtDate(data.range?.to)}`;

    const cards = [
      [
        '👁',
        'Просмотры',
        totals.views,
        `${count} публикаций · ${rangeText}`
      ],
      [
        '♥',
        'Лайки',
        totals.likes,
        `${count} публикаций · ${rangeText}`
      ],
      [
        '●',
        'Комментарии',
        totals.comments,
        `${count} публикаций · ${rangeText}`
      ],
      [
        '↗',
        'Репосты',
        totals.reposts,
        `${count} публикаций · ${rangeText}`
      ]
    ];

    container.innerHTML =
      cards
        .map(
          ([icon, title, value, sub]) => `
          <article
            class="kpi analytics-period-kpi"
          >
            <div class="icon">
              ${icon}
            </div>
            <h3>${esc(title)}</h3>
            <strong>
              ${fmtNumber(value)}
            </strong>
            <small>
              ${esc(sub)}
              <br>
              по последнему замеру
            </small>
          </article>
        `
        )
        .join('');
  }

  function renderTopPosts(data) {
    const container =
      document.querySelector(
        '#topPosts'
      );

    if (!container) return;

    const rows =
      data.posts?.top || [];

    if (!rows.length) {
      container.innerHTML = `
        <div
          class="meta analytics-period-owned"
        >
          За выбранный период
          публикаций со статистикой нет.
        </div>
      `;
      return;
    }

    container.innerHTML =
      rows
        .map(
          (row, index) => `
          <div
            class="rank-item analytics-period-owned"
          >
            <div class="rank-no">
              ${index + 1}
            </div>

            <strong>
              ${esc(row.title)}
            </strong>

            <span>
              ♥ ${fmtNumber(row.likes)}
            </span>

            <span>
              👁 ${fmtNumber(row.views)}
            </span>
          </div>
        `
        )
        .join('');
  }

  function renderAudience(data) {
    const container =
      document.querySelector(
        '#audienceSummary'
      );

    if (!container) return;

    container.classList.add(
      'period-audience-owned'
    );

    const audience =
      data.audience || {};

    const totals =
      audience.totals || {};

    const events =
      audience.events || {};

    const partialEvents =
      !events.complete;

    const incompleteSnapshots =
      !totals.snapshot_history_complete;

    const star =
      partialEvents ? '*' : '';

    let note = `
      Персональный журнал подписок
      и отписок ведётся с
      <strong>${COLLECTED_SINCE_RU}</strong>.
    `;

    if (partialEvents) {
      note += `
        Значения со * покрывают только
        часть выбранного периода.
      `;
    }

    if (incompleteSnapshots) {
      note += `
        История «Было → Стало»
        ещё накапливается, поэтому
        старые периоды могут содержать «—».
      `;
    }

    container.innerHTML = `
      <div
        class="period-audience analytics-period-owned"
      >
        <div class="period-audience-kpis">
          <div
            class="
              period-audience-card
              period-audience-card--total
            "
          >
            <div class="period-audience-label">
              Было → Стало
            </div>
            <div class="period-audience-value">
              ${fmtNumber(totals.start)}
              →
              ${fmtNumber(totals.end)}
            </div>
          </div>

          <div class="period-audience-card">
            <div class="period-audience-label">
              Подписалось
            </div>
            <div
              class="
                period-audience-value
                period-positive
              "
            >
              +${fmtNumber(
                events.joined
              )}${star}
            </div>
          </div>

          <div class="period-audience-card">
            <div class="period-audience-label">
              Отписалось
            </div>
            <div
              class="
                period-audience-value
                period-negative
              "
            >
              −${fmtNumber(
                events.left
              )}${star}
            </div>
          </div>

          <div class="period-audience-card">
            <div class="period-audience-label">
              Чистый прирост
            </div>
            <div
              class="
                period-audience-value
                ${signClass(
                  audience.net_change
                )}
              "
            >
              ${fmtNumber(
                audience.net_change,
                true
              )}
            </div>
          </div>

          <div class="period-audience-card">
            <div class="period-audience-label">
              Рост
            </div>
            <div
              class="
                period-audience-value
                ${signClass(
                  audience.growth_pct
                )}
              "
            >
              ${fmtPercent(
                audience.growth_pct
              )}
            </div>
          </div>
        </div>

        <div class="period-audience-actions">
          <button
            type="button"
            class="small-btn"
            data-period-people="join"
          >
            Кто подписался
          </button>

          <button
            type="button"
            class="small-btn"
            data-period-people="leave"
          >
            Кто отписался
          </button>
        </div>

        ${
          audience.warning
            ? `
              <p class="period-error-note">
                Общее число участников
                временно не удалось обновить:
                ${esc(displayError(audience.warning))}
              </p>
            `
            : ''
        }

        <p class="period-data-note">
          ${note}
        </p>
      </div>
    `;
  }

  function niceMax(value) {
    const n =
      Math.max(
        1,
        Number(value || 1)
      );

    const power =
      10 **
      Math.floor(
        Math.log10(n)
      );

    const scaled =
      n / power;

    let step;

    if (scaled <= 1) step = 1;
    else if (scaled <= 2) step = 2;
    else if (scaled <= 5) step = 5;
    else step = 10;

    return step * power;
  }

  function drawPeriodChart() {
    const canvas =
      document.querySelector(
        '#analyticsPeriodChart'
      );

    if (
      !canvas ||
      !chartState.range
    ) {
      return;
    }

    const host =
      canvas.closest(
        '.period-chart-host'
      );

    const w =
      host?.clientWidth || 0;

    if (w < 220) return;

    const h = 320;
    const dpr =
      window.devicePixelRatio || 1;

    canvas.width =
      Math.floor(w * dpr);

    canvas.height =
      Math.floor(h * dpr);

    canvas.style.width =
      `${w}px`;

    canvas.style.height =
      `${h}px`;

    const ctx =
      canvas.getContext('2d');

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      w,
      h
    );

    const margin = {
      left: 66,
      right: 18,
      top: 20,
      bottom: 46
    };

    const plotW =
      w -
      margin.left -
      margin.right;

    const plotH =
      h -
      margin.top -
      margin.bottom;

    const fromDay =
      isoDayNumber(
        chartState.range.from
      );

    const toDay =
      isoDayNumber(
        chartState.range.to
      );

    const spanDays =
      Math.max(
        1,
        toDay - fromDay
      );

    const dataMap =
      new Map(
        chartState.data.map(
          (row) => [
            row.date,
            row
          ]
        )
      );

    const maxViews =
      Math.max(
        0,
        ...chartState.data.map(
          (row) =>
            Number(row.views || 0)
        )
      );

    const yMax =
      niceMax(maxViews);

    ctx.font =
      '11px Arial, sans-serif';

    ctx.textBaseline =
      'middle';

    ctx.strokeStyle =
      '#d9dfe8';

    ctx.fillStyle =
      '#7f8b9c';

    ctx.lineWidth = 1;

    for (
      let i = 0;
      i <= 4;
      i++
    ) {
      const ratio = i / 4;

      const y =
        margin.top +
        plotH -
        ratio * plotH;

      ctx.beginPath();
      ctx.moveTo(
        margin.left,
        y
      );
      ctx.lineTo(
        w - margin.right,
        y
      );
      ctx.stroke();

      const value =
        Math.round(
          yMax * ratio
        );

      ctx.textAlign =
        'right';

      ctx.fillText(
        fmtCompact(value),
        margin.left - 9,
        y
      );
    }

    const tickCount =
      Math.min(
        6,
        spanDays + 1
      );

    ctx.fillStyle =
      '#7f8b9c';

    ctx.textAlign =
      'center';

    ctx.textBaseline =
      'top';

    const usedTickDays =
      new Set();

    for (
      let i = 0;
      i < tickCount;
      i++
    ) {
      const ratio =
        tickCount === 1
          ? 0
          : i /
            (tickCount - 1);

      const day =
        Math.round(
          fromDay +
          spanDays * ratio
        );

      if (
        usedTickDays.has(day)
      ) {
        continue;
      }

      usedTickDays.add(day);

      const x =
        margin.left +
        (
          (day - fromDay) /
          spanDays
        ) *
          plotW;

      const date =
        dateFromDayNumber(day);

      ctx.fillText(
        fmtShortDate(date),
        x,
        h -
          margin.bottom +
          12
      );
    }

    const dateSlots =
      spanDays + 1;

    const slotW =
      plotW /
      Math.max(
        1,
        dateSlots
      );

    const barW =
      Math.max(
        3,
        Math.min(
          24,
          slotW * 0.58
        )
      );

    chartState.bars = [];

    const rows =
      [...chartState.data].sort(
        (a, b) =>
          String(a.date)
            .localeCompare(
              String(b.date)
            )
      );

    for (const row of rows) {
      const day =
        isoDayNumber(row.date);

      const x =
        margin.left +
        (
          (day - fromDay) /
          spanDays
        ) *
          plotW;

      const value =
        Number(row.views || 0);

      const barH =
        yMax > 0
          ? (value / yMax) *
            plotH
          : 0;

      const y =
        margin.top +
        plotH -
        barH;

      const gradient =
        ctx.createLinearGradient(
          0,
          y,
          0,
          margin.top + plotH
        );

      gradient.addColorStop(
        0,
        '#d5a43a'
      );

      gradient.addColorStop(
        1,
        '#0d448f'
      );

      ctx.fillStyle =
        gradient;

      ctx.beginPath();

      if (
        typeof ctx.roundRect ===
        'function'
      ) {
        ctx.roundRect(
          x - barW / 2,
          y,
          barW,
          Math.max(2, barH),
          4
        );
      } else {
        ctx.rect(
          x - barW / 2,
          y,
          barW,
          Math.max(2, barH)
        );
      }

      ctx.fill();

      chartState.bars.push({
        x,
        y,
        width: barW,
        bottom:
          margin.top + plotH,
        row
      });
    }

    if (!rows.length) {
      ctx.fillStyle =
        '#7f8b9c';

      ctx.textAlign =
        'center';

      ctx.textBaseline =
        'middle';

      ctx.font =
        '13px Arial, sans-serif';

      ctx.fillText(
        'За выбранный период публикаций нет.',
        margin.left +
          plotW / 2,
        margin.top +
          plotH / 2
      );
    }
  }

  function handleChartMouseMove(
    event
  ) {
    const canvas =
      event.currentTarget;

    const rect =
      canvas.getBoundingClientRect();

    const x =
      event.clientX -
      rect.left;

    const y =
      event.clientY -
      rect.top;

    let best = null;
    let distance = Infinity;

    for (
      const bar of
      chartState.bars
    ) {
      const dx =
        Math.abs(
          x - bar.x
        );

      const hitX =
        dx <=
        Math.max(
          10,
          bar.width
        );

      const hitY =
        y >=
          bar.y - 14 &&
        y <=
          bar.bottom + 8;

      if (
        hitX &&
        hitY &&
        dx < distance
      ) {
        best = bar;
        distance = dx;
      }
    }

    if (!best) {
      hideChartTooltip();
      return;
    }

    showChartTooltip(
      best,
      rect
    );
  }

  function showChartTooltip(
    bar,
    canvasRect
  ) {
    const host =
      document.querySelector(
        '.period-chart-host'
      );

    const tooltip =
      document.querySelector(
        '#analyticsChartTooltip'
      );

    if (!host || !tooltip) return;

    const hostRect =
      host.getBoundingClientRect();

    const row = bar.row;

    tooltip.innerHTML = `
      <strong>
        ${esc(
          fmtDate(row.date)
        )}
      </strong>

      ${fmtNumber(
        row.views
      )} просмотров

      <br>

      ${fmtNumber(
        row.posts
      )}
      ${
        Number(row.posts) === 1
          ? 'публикация'
          : 'публикации'
      }
    `;

    tooltip.classList.remove(
      'hidden'
    );

    let left =
      canvasRect.left -
      hostRect.left +
      bar.x;

    let top =
      canvasRect.top -
      hostRect.top +
      bar.y -
      8;

    left =
      Math.max(
        80,
        Math.min(
          host.clientWidth - 80,
          left
        )
      );

    top =
      Math.max(
        72,
        top
      );

    tooltip.style.left =
      `${left}px`;

    tooltip.style.top =
      `${top}px`;
  }

  function hideChartTooltip() {
    document
      .querySelector(
        '#analyticsChartTooltip'
      )
      ?.classList.add(
        'hidden'
      );
  }

  function renderChart(data) {
    ensureChartHost();

    chartState.data =
      data.posts?.by_date || [];

    chartState.range =
      data.range || null;

    requestAnimationFrame(
      drawPeriodChart
    );

    setTimeout(
      drawPeriodChart,
      80
    );
  }

  function renderAll(data) {
    currentData = data;

    renderPostKpis(data);
    renderTopPosts(data);
    renderAudience(data);
    renderChart(data);
  }

  function renderGlobalError(message) {
    const kpis =
      document.querySelector(
        '#analyticsKpis'
      );

    if (kpis) {
      kpis.innerHTML = `
        <div
          class="section-intro analytics-period-owned"
          style="grid-column:1/-1"
        >
          Не удалось загрузить аналитику:
          ${esc(message)}
        </div>
      `;
    }

    const audience =
      document.querySelector(
        '#audienceSummary'
      );

    if (audience) {
      audience.classList.add(
        'period-audience-owned'
      );

      audience.innerHTML = `
        <div
          class="period-empty analytics-period-owned"
        >
          Аналитика аудитории
          временно недоступна.
        </div>
      `;
    }
  }

  async function refreshAnalytics() {
    const serial =
      ++requestSerial;

    try {
      ensureToolbar();
      ensureChartHost();

      const { data: sessionData } =
        await client.auth.getSession();

      if (
        !sessionData?.session
      ) {
        throw new Error(
          'Сначала войдите в Tracker.'
        );
      }

      const payload =
        buildPayload();

      const data =
        await invokeAnalytics(
          payload
        );

      if (
        serial !== requestSerial
      ) {
        return;
      }

      renderAll(data);
    } catch (error) {
      if (
        serial !== requestSerial
      ) {
        return;
      }

      console.error(
        '[Analytics v1.8.2]',
        error
      );

      renderGlobalError(
        error instanceof Error
          ? error.message
          : String(error)
      );
    }
  }

  function openModal(
    title,
    html
  ) {
    const modal =
      document.querySelector(
        '#modal'
      );

    const backdrop =
      document.querySelector(
        '#modalBackdrop'
      );

    const modalTitle =
      document.querySelector(
        '#modalTitle'
      );

    const modalBody =
      document.querySelector(
        '#modalBody'
      );

    if (
      !modal ||
      !backdrop ||
      !modalTitle ||
      !modalBody
    ) {
      return;
    }

    modalTitle.textContent =
      title;

    modalBody.innerHTML =
      html;

    backdrop.classList.remove(
      'hidden'
    );

    modal.classList.remove(
      'hidden'
    );
  }

  function renderPeople(
    type,
    data
  ) {
    const title =
      type === 'join'
        ? 'Кто подписался'
        : 'Кто отписался';

    const rows =
      data.items || [];

    const range =
      currentData?.range;

    const html =
      rows.length
        ? `
          <div class="section-intro compact">
            <p>
              ${fmtDate(range?.from)}
              —
              ${fmtDate(range?.to)}
              · найдено:
              <strong>
                ${rows.length}
              </strong>
            </p>
          </div>

          <div class="period-person-list">
            ${rows
              .map((item) => {
                const fullName =
                  [
                    item.first_name,
                    item.last_name
                  ]
                    .filter(Boolean)
                    .join(' ')
                    .trim() ||
                  `VK ID ${item.user_id}`;

                const fallback =
                  'assets/brand-logo.png';

                const leaveMeta =
                  type === 'leave' &&
                  item.left_self === true
                    ? ' · вышел(а) самостоятельно'
                    : '';

                return `
                  <div class="period-person">
                    <img
                      src="${esc(
                        item.photo_100 ||
                        fallback
                      )}"
                      alt=""
                      onerror="
                        this.src='${fallback}'
                      "
                    >

                    <div>
                      <div
                        class="period-person__name"
                      >
                        ${esc(fullName)}
                      </div>

                      <div
                        class="period-person__meta"
                      >
                        ${esc(
                          fmtDateTime(
                            item.occurred_at
                          )
                        )}
                        ${esc(
                          leaveMeta
                        )}
                      </div>
                    </div>

                    <a
                      class="
                        small-btn
                        action-link
                      "
                      href="${esc(
                        item.profile_url
                      )}"
                      target="_blank"
                      rel="noopener"
                    >
                      Открыть VK ↗
                    </a>
                  </div>
                `;
              })
              .join('')}
          </div>
        `
        : `
          <div class="period-empty">
            За выбранный период
            пока нет зафиксированных
            ${
              type === 'join'
                ? 'подписок'
                : 'отписок'
            }.
          </div>
        `;

    openModal(
      title,
      html
    );
  }

  async function showPeople(
    type,
    button
  ) {
    const range =
      currentData?.range;

    if (!range) return;

    const old =
      button.textContent;

    button.disabled = true;
    button.textContent =
      'Загрузка…';

    try {
      const data =
        await invokePeople(
          type,
          range
        );

      renderPeople(
        type,
        data
      );
    } catch (error) {
      console.error(
        '[Audience People]',
        error
      );

      openModal(
        'Аудитория',
        `
          <div class="period-empty">
            Не удалось получить
            список людей.<br>
            <span class="meta">
              ${esc(
                error instanceof Error
                  ? error.message
                  : String(error)
              )}
            </span>
          </div>
        `
      );
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  function restoreOwnedContent() {
    if (!currentData) return;

    const kpis =
      document.querySelector(
        '#analyticsKpis'
      );

    if (
      kpis &&
      !kpis.querySelector(
        '.analytics-period-kpi'
      )
    ) {
      renderPostKpis(
        currentData
      );
    }

    const top =
      document.querySelector(
        '#topPosts'
      );

    if (
      top &&
      !top.querySelector(
        '.analytics-period-owned'
      )
    ) {
      renderTopPosts(
        currentData
      );
    }

    const audience =
      document.querySelector(
        '#audienceSummary'
      );

    if (
      audience &&
      !audience.querySelector(
        '.analytics-period-owned'
      )
    ) {
      renderAudience(
        currentData
      );
    }
  }

  function scheduleRestore() {
    clearTimeout(
      restoreTimer
    );

    restoreTimer =
      setTimeout(
        restoreOwnedContent,
        30
      );
  }

  function installObservers() {
    [
      '#analyticsKpis',
      '#topPosts',
      '#audienceSummary'
    ].forEach((selector) => {
      const el =
        document.querySelector(
          selector
        );

      if (!el) return;

      const observer =
        new MutationObserver(
          scheduleRestore
        );

      observer.observe(el, {
        childList: true
      });
    });

    const analyticsPage =
      document.querySelector(
        '#page-analytics'
      );

    if (analyticsPage) {
      const pageObserver =
        new MutationObserver(() => {
          if (
            analyticsPage.classList
              .contains('active')
          ) {
            requestAnimationFrame(
              drawPeriodChart
            );
          }
        });

      pageObserver.observe(
        analyticsPage,
        {
          attributes: true,
          attributeFilter: [
            'class'
          ]
        }
      );
    }
  }

  function start() {
    installStyles();

    const page =
      document.querySelector(
        '#page-analytics'
      );

    if (!page) {
      setTimeout(
        start,
        350
      );
      return;
    }

    ensureToolbar();
    ensureChartHost();
    installObservers();

    document.addEventListener(
      'click',
      (event) => {
        const peopleButton =
          event.target.closest(
            '[data-period-people]'
          );

        if (peopleButton) {
          showPeople(
            peopleButton.dataset
              .periodPeople,
            peopleButton
          );
        }

        const nav =
          event.target.closest(
            '[data-page="analytics"]'
          );

        if (nav) {
          setTimeout(
            drawPeriodChart,
            80
          );
        }
      }
    );

    const refresh =
      document.querySelector(
        '#refreshBtn'
      );

    if (refresh) {
      refresh.addEventListener(
        'click',
        () => {
          setTimeout(
            refreshAnalytics,
            1200
          );
        }
      );
    }

    window.addEventListener(
      'resize',
      () =>
        requestAnimationFrame(
          drawPeriodChart
        )
    );

    refreshAnalytics();
  }

  start();
})();
