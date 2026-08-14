/* =========================================================
   CONTENT STUDIO TRACKER v1.6 — ONE-TIME VK COVER BACKFILL UI

   Временный модуль для массовой загрузки обложек старых VK-постов.
   После завершения его можно убрать из index.html.
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

  async function invoke(body) {
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
      throw new Error(data?.error || 'VK cover sync returned an error.');
    }

    return data;
  }

  function installButton() {
    if (document.querySelector('#vkCoversBtn')) return;

    const vkBtn = document.querySelector('#vkSyncBtn');
    const refresh = document.querySelector('#refreshBtn');

    if (!vkBtn && !refresh) {
      setTimeout(installButton, 500);
      return;
    }

    const anchor = vkBtn || refresh;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'vkCoversBtn';
    btn.className = anchor.className || 'btn secondary';
    btn.textContent = 'VK Фото';
    btn.title = 'Подтянуть обложки старых материалов из VK';

    anchor.parentNode.insertBefore(btn, anchor);
    btn.addEventListener('click', run);

    setTimeout(refreshState, 500);
  }

  function setButton(text, disabled = false) {
    const btn = document.querySelector('#vkCoversBtn');
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = disabled;
  }

  async function refreshState() {
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session) return;

      const status = await invoke({ mode: 'status' });

      if (status.covers_complete) {
        setButton('VK Фото ✓', true);
      } else {
        setButton('VK Фото', false);
      }
    } catch (error) {
      console.warn('[VK Covers] Status check failed:', error);
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

      if (!status.initial_complete) {
        alert(
          'Сначала должен полностью завершиться первичный импорт данных VK.\n\n' +
          `Сейчас сохранённый offset: ${Number(status.next_offset || 0)}.`
        );
        return;
      }

      if (status.covers_complete) {
        setButton('VK Фото ✓', true);
        alert('Массовая загрузка старых VK-обложек уже завершена.');
        return;
      }

      const total = Number(status.total_posts_on_wall || 0);
      const start = Number(status.cover_next_offset || 0);

      const ok = confirm(
        'Загрузить обложки старых VK-материалов?\n\n' +
        `Стена VK: ${total} позиций\n` +
        `Продолжить с offset: ${start}\n\n` +
        'Правило: первая обычная фотография поста.\n' +
        'Посты без фото останутся без обложки.\n' +
        'Существующие и вручную установленные обложки НЕ перезаписываются.\n\n' +
        'Вкладку лучше не закрывать до сообщения о завершении.'
      );

      if (!ok) return;

      let imported = 0;
      let existing = 0;
      let noPhoto = 0;
      let missingPublication = 0;

      while (true) {
        const page = await invoke({
          mode: 'covers',
          count: 8
        });

        imported += Number(page.summary?.cover_imported || 0);
        existing += Number(page.summary?.cover_exists || 0);
        noPhoto += Number(page.summary?.no_photo || 0);
        missingPublication += Number(page.summary?.publication_missing || 0);

        if (Number(page.summary?.errors || 0) > 0) {
          const first = page.errors?.[0];
          throw new Error(
            `Обложки остановлены на offset ${page.offset}. ` +
            `${first?.message || 'В одной записи возникла ошибка.'}`
          );
        }

        const progress = Math.min(
          Number(page.next_offset || 0),
          Number(page.total_posts_on_wall || total)
        );

        setButton(`Фото ${progress}/${Number(page.total_posts_on_wall || total)}`, true);

        if (page.done) {
          setButton('VK Фото ✓', true);

          alert(
            'Загрузка старых VK-обложек завершена.\n\n' +
            `Загружено новых обложек: ${imported}\n` +
            `Уже были установлены: ${existing}\n` +
            `Постов без обычной фотографии: ${noPhoto}\n` +
            `Недоступных/неимпортированных публикаций в просмотренных данных: ${missingPublication}`
          );

          location.reload();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 220));
      }
    } catch (error) {
      console.error('[VK Covers]', error);
      setButton('VK Фото ⚠', false);

      alert(
        'Загрузка обложек остановлена.\n\n' +
        `${error instanceof Error ? error.message : String(error)}\n\n` +
        'Прогресс уже сохранён в Supabase. После устранения причины ' +
        'следующее нажатие продолжит с сохранённого места.'
      );
    } finally {
      busy = false;
      const btn = document.querySelector('#vkCoversBtn');
      if (btn && btn.disabled && btn.textContent !== 'VK Фото ✓') {
        btn.disabled = false;
      }
    }
  }

  installButton();
})();
