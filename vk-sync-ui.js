/* =========================================================
   CONTENT STUDIO TRACKER v1.6 — VK SYNC UI
   Безопасная надстройка поверх рабочей v1.5.
   app.js не изменяет.

   Сейчас используется для:
   - проверки состояния VK-импорта;
   - первичного импорта ВСЕХ текстовых данных без обложек;
   - после завершения — быстрой синхронизации последних VK-постов.

   Массовую загрузку старых обложек включим отдельным шагом
   после проверки полного текстового импорта.
   ========================================================= */

(() => {
  'use strict';

  const CFG = window.CONTENT_STUDIO_CONFIG || {};
  const validConfig =
    /^https:\/\/.+\.supabase\.co$/i.test(CFG.SUPABASE_URL || '') &&
    /^(sb_publishable_|eyJ)/.test(CFG.SUPABASE_PUBLISHABLE_KEY || '');

  if (!window.supabase || !validConfig) {
    console.warn('[VK Sync UI] Supabase config not found.');
    return;
  }

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

  let busy = false;

  function toast(message) {
    const el = document.querySelector('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function installStyles() {
    if (document.querySelector('#vkSyncUiStyles')) return;

    const style = document.createElement('style');
    style.id = 'vkSyncUiStyles';
    style.textContent = `
      #vkSyncBtn{
        white-space:nowrap;
      }
      #vkSyncBtn.vk-sync-working{
        opacity:.78;
        cursor:wait;
      }
    `;
    document.head.appendChild(style);
  }

  function installButton() {
    if (document.querySelector('#vkSyncBtn')) return;

    const refresh = document.querySelector('#refreshBtn');
    if (!refresh) {
      setTimeout(installButton, 500);
      return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'vkSyncBtn';
    btn.className = refresh.className || 'btn secondary';
    btn.textContent = 'VK ↻';
    btn.title = 'Синхронизация материалов и статистики с VK';

    refresh.parentNode.insertBefore(btn, refresh);
    btn.addEventListener('click', run);
  }

  function setButton(text, working = false) {
    const btn = document.querySelector('#vkSyncBtn');
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = working;
    btn.classList.toggle('vk-sync-working', working);
  }

  async function invoke(body) {
    const { data, error } = await client.functions.invoke('vk-sync', {
      body
    });

    if (error) {
      let details = error.message || String(error);
      try {
        const extra = await error.context?.json?.();
        if (extra?.error) details = extra.error;
        if (extra?.message) details = extra.message;
      } catch {}
      throw new Error(details);
    }

    if (!data?.ok) {
      throw new Error(data?.error || 'VK Sync returned an error.');
    }

    return data;
  }

  async function runInitialImport(status) {
    const total = Number(status.total_posts_on_wall || 0);
    const already = Number(status.imported || 0);
    const ignored = Number(status.ignored || 0);

    const ok = confirm(
      `Первичный импорт VK.\n\n` +
      `Постов на стене: ${total}\n` +
      `Уже в Tracker: ${already}\n` +
      `Игнорируются после удаления: ${ignored}\n\n` +
      `Сейчас импортируются НАЗВАНИЯ, ОПИСАНИЯ, ДАТЫ, ССЫЛКИ ` +
      `и СТАТИСТИКА.\n\n` +
      `Обложки старых постов на этом шаге НЕ загружаются.\n\n` +
      `Начать?`
    );

    if (!ok) return;

    let offset = 0;
    let importedNew = 0;
    let updatedExisting = 0;
    let ignoredCount = 0;

    while (true) {
      setButton(
        total
          ? `VK ${Math.min(offset, total)}/${total}`
          : `VK ${offset}`,
        true
      );

      const page = await invoke({
        mode: 'data',
        offset,
        count: 25
      });

      importedNew += Number(page.summary?.imported_new || 0);
      updatedExisting += Number(page.summary?.updated_existing || 0);
      ignoredCount += Number(page.summary?.ignored || 0);

      if (Number(page.summary?.errors || 0) > 0) {
        const first = page.errors?.[0];
        throw new Error(
          `Импорт остановлен на offset ${offset}. ` +
          `${first?.message || 'В одной из записей возникла ошибка.'}`
        );
      }

      const next = Number(page.next_offset ?? offset);
      if (next <= offset && !page.done) {
        throw new Error('VK Sync не продвинулся к следующей странице.');
      }

      offset = next;

      if (page.done) {
        setButton('VK ✓', false);

        alert(
          `Первичный импорт данных VK завершён.\n\n` +
          `Новых материалов: ${importedNew}\n` +
          `Уже существующих обновлено: ${updatedExisting}\n` +
          `Пропущено по памяти удаления: ${ignoredCount}\n\n` +
          `Обложки старых материалов пока не загружались.`
        );

        location.reload();
        return;
      }

      // Маленькая пауза между вызовами — не нагружаем Edge Functions.
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  async function runRecentSync() {
    const ok = confirm(
      'Синхронизировать последние VK-посты?\n\n' +
      'Новые посты будут добавлены вместе с первой фотографией, ' +
      'а у уже известных обновится сегодняшняя статистика.'
    );

    if (!ok) return;

    setButton('VK…', true);

    const result = await invoke({ mode: 'recent' });

    if (Number(result.summary?.errors || 0) > 0) {
      const first = result.errors?.[0];
      throw new Error(
        first?.message || 'При синхронизации возникла ошибка.'
      );
    }

    setButton('VK ✓', false);

    alert(
      `VK синхронизирован.\n\n` +
      `Новых материалов: ${Number(result.summary?.imported_new || 0)}\n` +
      `Обновлено существующих: ${Number(result.summary?.updated_existing || 0)}\n` +
      `Новых обложек: ${Number(result.summary?.covers_imported || 0)}`
    );

    location.reload();
  }

  async function run() {
    if (busy) return;
    busy = true;

    try {
      const { data: sessionData } = await client.auth.getSession();

      if (!sessionData?.session) {
        toast('Сначала войдите в Tracker.');
        return;
      }

      setButton('VK…', true);
      const status = await invoke({ mode: 'status' });

      if (status.initial_complete) {
        setButton('VK ↻', false);
        await runRecentSync();
      } else {
        setButton('VK ↻', false);
        await runInitialImport(status);
      }
    } catch (error) {
      console.error('[VK Sync UI]', error);
      setButton('VK ⚠', false);

      alert(
        `Синхронизация VK остановлена.\n\n` +
        `${error instanceof Error ? error.message : String(error)}\n\n` +
        `Уже записанные материалы не потеряны и не продублируются ` +
        `при повторном запуске.`
      );
    } finally {
      busy = false;
      const btn = document.querySelector('#vkSyncBtn');
      if (btn && btn.disabled) setButton('VK ↻', false);
    }
  }

  installStyles();
  installButton();
})();
