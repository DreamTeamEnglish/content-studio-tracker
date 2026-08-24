/* =========================================================
   CONTENT STUDIO TRACKER v1.8 — VK SYNC UI · HYBRID COVERS
   Безопасная надстройка поверх рабочей v1.5.
   app.js не изменяет.

   Сейчас используется для:
   - проверки состояния VK-импорта;
   - первичного импорта ВСЕХ текстовых данных без обложек;
   - после завершения — быстрой синхронизации последних VK-постов;
   - одноразового перевода старых VK-обложек из Supabase Storage
     на прямые preview URL VK.

   Новые VK-обложки в Supabase Storage больше не копируются.
   ========================================================= */

(() => {
  'use strict';

  const COVER_STRATEGY = 'hybrid_vk_url_cleanup_v2';
  const COVER_MIGRATION_DONE_KEY = 'cst-vk-cover-migration:hybrid-v2';

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

  async function runLegacyStorageCleanup(status = null, skipConfirm = false) {
    const orphaned = Number(status?.legacy_vk_storage_orphans || 0);

    if (!skipConfirm && orphaned > 0) {
      const ok = confirm(
        `В Supabase Storage осталось старых неиспользуемых VK-файлов: ${orphaned}.\n\n` +
        `Удалить их?\n\n` +
        `Сервер перед удалением ещё раз проверит всю таблицу materials. ` +
        `Удаляются ТОЛЬКО файлы materials/vk-..., на которые больше нет ссылок.\n\n` +
        `Ручные обложки не затрагиваются.`
      );
      if (!ok) {
        toast('Очистка старых VK-файлов отложена.');
        return false;
      }
    }

    setButton('VK очистка…', true);
    const cleanup = await invoke({ mode: 'cleanup_covers' });
    const summary = cleanup.summary || {};

    if (Number(summary.errors || 0) > 0) {
      const first = cleanup.errors?.[0];
      throw new Error(
        `Очистка Storage выполнена не полностью. ` +
        `${first?.message || 'Часть файлов не удалось удалить.'}`
      );
    }

    setButton('VK ✓', false);

    return {
      deleted: Number(summary.deleted || 0),
      keptReferenced: Number(summary.kept_referenced_after || 0),
      remaining: Number(summary.legacy_objects_after || 0),
      manualTouched: Number(summary.manual_objects_touched || 0),
    };
  }

  async function runLegacyCoverMigration(status) {
    const legacy = Number(status.legacy_vk_storage_covers || 0);
    if (!legacy) return false;

    const ok = confirm(
      `Найдено старых VK-обложек, которые ещё используются из Supabase Storage: ${legacy}.\n\n` +
      `Перевести их на прямые preview URL VK и затем удалить только освободившиеся ` +
      `старые авто-VK файлы?\n\n` +
      `Перед удалением сервер повторно проверит, что на файл больше не ссылается ` +
      `ни один материал. Ручные обложки не удаляются.`
    );

    if (!ok) {
      toast('Перевод старых VK-обложек отложен.');
      return false;
    }

    let offset = 0;
    let migrated = 0;
    let linked = 0;
    let existing = 0;
    let noPhoto = 0;

    while (true) {
      setButton(`VK фото ${offset}`, true);

      const page = await invoke({
        mode: 'migrate_covers',
        offset,
        count: 50
      });

      migrated += Number(page.summary?.cover_migrated || 0);
      linked += Number(page.summary?.cover_imported || 0);
      existing += Number(page.summary?.cover_exists || 0);
      noPhoto += Number(page.summary?.no_photo || 0);

      if (Number(page.summary?.errors || 0) > 0) {
        const first = page.errors?.[0];
        throw new Error(
          `Перевод обложек остановлен на offset ${offset}. ` +
          `${first?.message || 'В одной записи возникла ошибка.'}`
        );
      }

      const total = Number(page.total_posts_on_wall || 0);
      const next = Number(page.next_offset ?? offset);
      if (next <= offset && !page.done) {
        throw new Error('VK Sync не продвинулся к следующей странице обложек.');
      }

      offset = next;
      setButton(`VK фото ${Math.min(offset,total)}/${total}`, true);

      if (page.done) {
        localStorage.setItem(COVER_MIGRATION_DONE_KEY, COVER_STRATEGY);

        // Миграция завершена. Теперь отдельный серверный шаг заново сверяет
        // все ссылки и удаляет только освободившиеся старые materials/vk-*.
        const cleanup = await runLegacyStorageCleanup(null, true);

        alert(
          `Перевод VK-обложек завершён.\n\n` +
          `Переключено со Storage на VK URL: ${migrated}\n` +
          `Ранее пустых обложек подключено к VK: ${linked}\n` +
          `Ручных/уже внешних оставлено без изменений: ${existing}\n` +
          `Постов без доступной фотографии VK: ${noPhoto}\n\n` +
          `Старых неиспользуемых VK-файлов удалено из Storage: ${cleanup?.deleted || 0}\n` +
          `Старых VK-файлов оставлено, потому что они ещё используются: ${cleanup?.keptReferenced || 0}\n` +
          `Ручных файлов удалено: ${cleanup?.manualTouched || 0}`
        );
        location.reload();
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function runRecentSync() {
    const ok = confirm(
      'Синхронизировать последние VK-посты?\n\n' +
      'Новые посты будут добавлены со ссылкой на превью первой фотографии VK, ' +
      'без копирования картинки в Supabase Storage. У уже известных ' +
      'обновится сегодняшняя статистика.'
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
      `VK-обложек подключено: ${Number(result.summary?.covers_imported || 0)}`
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

      if (status.cover_strategy !== COVER_STRATEGY) {
        setButton('VK ⚠', false);
        alert(
          'VK-синхронизация остановлена безопасно.\n\n' +
          'На сервере ещё старая версия vk-sync, которая может копировать фотографии ' +
          'в Supabase Storage. Сначала обновите Edge Function vk-sync.'
        );
        return;
      }

      const legacyInUse = Number(status.legacy_vk_storage_covers || 0);
      const orphanedLegacy = Number(status.legacy_vk_storage_orphans || 0);
      const migrationAlreadyDone = localStorage.getItem(COVER_MIGRATION_DONE_KEY) === COVER_STRATEGY;

      if (status.initial_complete && legacyInUse > 0 && !migrationAlreadyDone) {
        setButton('VK ↻', false);
        await runLegacyCoverMigration(status);
        return;
      }

      if (status.initial_complete && orphanedLegacy > 0) {
        setButton('VK ↻', false);
        const cleanup = await runLegacyStorageCleanup(status, false);
        if (cleanup) {
          alert(
            `Очистка Storage завершена.\n\n` +
            `Удалено старых неиспользуемых VK-файлов: ${cleanup.deleted}\n` +
            `Оставлено используемых старых VK-файлов: ${cleanup.keptReferenced}\n` +
            `Ручных файлов удалено: ${cleanup.manualTouched}`
          );
          location.reload();
        }
        return;
      }

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
