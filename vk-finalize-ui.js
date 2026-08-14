/* =========================================================
   CONTENT STUDIO TRACKER v1.6 — FINAL VK RECONCILIATION UI

   Временная кнопка для одного контрольного прохода всей доступной
   стены VK. После успешного завершения модуль можно удалить.
   ========================================================= */

(() => {
  'use strict';

  const CFG = window.CONTENT_STUDIO_CONFIG || {};
  const validConfig =
    /^https:\/\/.+\.supabase\.co$/i.test(CFG.SUPABASE_URL || '') &&
    /^(sb_publishable_|eyJ)/.test(CFG.SUPABASE_PUBLISHABLE_KEY || '');

  if (!window.supabase || !validConfig) return;

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

  async function invokeOnce(body) {
    const { data, error } = await client.functions.invoke('vk-sync', { body });

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
      throw new Error(data?.error || 'VK reconciliation returned an error.');
    }

    return data;
  }

  async function invoke(body, maxAttempts = 4) {
    const delays = [3000, 6000, 10000];
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await invokeOnce(body);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;

        const waitMs = delays[Math.min(attempt - 1, delays.length - 1)];
        setButton(`VK Проверка • повтор ${attempt}/3`, true);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    throw lastError || new Error('VK reconciliation failed after retries.');
  }

  function installButton() {
    if (document.querySelector('#vkFinalizeBtn')) return;

    const coverBtn = document.querySelector('#vkCoversBtn');
    const vkBtn = document.querySelector('#vkSyncBtn');
    const anchor = coverBtn || vkBtn;

    if (!anchor) {
      setTimeout(installButton, 500);
      return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'vkFinalizeBtn';
    btn.className = anchor.className || 'btn secondary';
    btn.textContent = 'VK Проверка';
    btn.title = 'Финальный контрольный проход VK';

    anchor.parentNode.insertBefore(btn, anchor);
    btn.addEventListener('click', run);

    setTimeout(refreshState, 500);
  }

  function setButton(text, disabled = false) {
    const btn = document.querySelector('#vkFinalizeBtn');
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = disabled;
  }

  async function refreshState() {
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session) return;

      const status = await invoke({ mode: 'status' });

      if (status.reconcile_complete) {
        setButton('VK Проверка ✓', true);
      }
    } catch (error) {
      console.warn('[VK Finalize] Status check failed:', error);
    }
  }

  async function run() {
    if (busy) return;
    busy = true;

    try {
      const { data: sessionData } = await client.auth.getSession();

      if (!sessionData?.session) {
        alert('Сначала войдите в Tracker.');
        return;
      }

      const status = await invoke({ mode: 'status' });

      if (!status.initial_complete || !status.covers_complete) {
        alert(
          'Финальную проверку пока запускать нельзя.\n\n' +
          `Импорт данных завершён: ${Boolean(status.initial_complete)}\n` +
          `Обложки завершены: ${Boolean(status.covers_complete)}`
        );
        return;
      }

      if (status.reconcile_complete) {
        setButton('VK Проверка ✓', true);
        alert('Финальная проверка VK уже завершена.');
        return;
      }

      const ok = confirm(
        'Запустить финальную проверку VK?\n\n' +
        `Постов на стене сейчас: ${Number(status.total_posts_on_wall || 0)}\n` +
        `Начать с offset: ${Number(status.reconcile_next_offset || 0)}\n\n` +
        'Проверка повторно проходит доступную стену с перекрытием диапазонов.\n' +
        'Дубли не создаются. Если найдётся пропущенная публикация, она будет ' +
        'добавлена сразу с описанием, статистикой и первой фотографией.'
      );

      if (!ok) return;

      let imported = 0;
      let updated = 0;
      let covers = 0;
      let ignored = 0;

      while (true) {
        const page = await invoke({ mode: 'reconcile' });

        imported += Number(page.summary?.imported_new || 0);
        updated += Number(page.summary?.updated_existing || 0);
        covers += Number(page.summary?.covers_imported || 0);
        ignored += Number(page.summary?.ignored || 0);

        if (Number(page.summary?.errors || 0) > 0) {
          const first = page.errors?.[0];
          throw new Error(
            `Проверка остановлена на offset ${page.offset}. ` +
            `${first?.message || 'В одной записи возникла ошибка.'}`
          );
        }

        const total = Number(page.total_posts_on_wall || 0);
        const progress = Math.min(Number(page.next_offset || 0), total);
        setButton(`Проверка ${progress}/${total}`, true);

        if (page.done) {
          // Последний быстрый проход по свежим 25 постам:
          // если что-то появилось сверху во время reconciliation,
          // это попадёт сюда.
          const recent = await invoke({ mode: 'recent' });

          imported += Number(recent.summary?.imported_new || 0);
          updated += Number(recent.summary?.updated_existing || 0);
          covers += Number(recent.summary?.covers_imported || 0);

          setButton('VK Проверка ✓', true);

          alert(
            'Финальная проверка VK завершена.\n\n' +
            `Найдено и добавлено пропущенных/новых материалов: ${imported}\n` +
            `Проверено/обновлено существующих записей: ${updated}\n` +
            `Добавлено обложек для найденных новых записей: ${covers}\n` +
            `Пропущено по памяти удаления: ${ignored}\n\n` +
            'VK-импорт можно считать финализированным.'
          );

          location.reload();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } catch (error) {
      console.error('[VK Finalize]', error);
      setButton('VK Проверка ⚠', false);

      alert(
        'Финальная проверка остановлена после автоматических повторов.\n\n' +
        `${error instanceof Error ? error.message : String(error)}\n\n` +
        'Прогресс сохранён в Supabase. Следующее нажатие продолжит с ' +
        'сохранённого reconcile_next_offset.'
      );
    } finally {
      busy = false;

      const btn = document.querySelector('#vkFinalizeBtn');
      if (
        btn &&
        btn.disabled &&
        btn.textContent !== 'VK Проверка ✓'
      ) {
        btn.disabled = false;
      }
    }
  }

  installButton();
})();
