/* =========================================================
   CONTENT STUDIO TRACKER v1.6 — DESCRIPTION UI ADD-ON
   Безопасная надстройка поверх рабочей v1.5.

   Что добавляет:
   - кнопку «Описание» на карточку, только если description заполнено;
   - окно чтения полного описания;
   - поле «Описание» в форме «Изменить материал»;
   - сохранение description в Supabase после успешного сохранения
     остальных полей штатной логикой app.js.

   Что НЕ меняет:
   - app.js;
   - config.js;
   - таблицы/политики Supabase;
   - логику публикаций, статистики, удаления и обложек.
   ========================================================= */

(() => {
  'use strict';

  const CFG = window.CONTENT_STUDIO_CONFIG || {};
  const validConfig =
    /^https:\/\/.+\.supabase\.co$/i.test(CFG.SUPABASE_URL || '') &&
    /^(sb_publishable_|eyJ)/.test(CFG.SUPABASE_PUBLISHABLE_KEY || '');

  if (!window.supabase || !validConfig) {
    console.warn('[Description UI] Supabase config not found.');
    return;
  }

  // Повторяем ту же схему хранения сессии, что и рабочий app.js v1.5.
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

  const cache = new Map();
  let activeEditMaterialId = null;
  let refreshTimer = null;

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);

  function toast(message) {
    const el = document.querySelector('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2600);
  }

  function installStyles() {
    if (document.querySelector('#descriptionUiStyles')) return;

    const style = document.createElement('style');
    style.id = 'descriptionUiStyles';
    style.textContent = `
      .material-description-btn{
        border-color:rgba(13,52,94,.48);
        color:#163f72;
        background:#fff;
      }
      .material-description-btn:hover{
        border-color:#c99b37;
        color:#866313;
      }
      .material-description-view{
        white-space:pre-wrap;
        overflow-wrap:anywhere;
        line-height:1.65;
        font-size:14px;
        color:#25364f;
        background:#fff;
        border:1px solid rgba(13,52,94,.28);
        border-radius:14px;
        padding:18px 20px;
        max-height:56vh;
        overflow:auto;
        box-shadow:inset 0 0 0 1px rgba(201,155,55,.05);
      }
      .material-description-empty{
        color:#778497;
        font-style:italic;
      }
      .description-edit-field textarea{
        min-height:190px;
        line-height:1.5;
      }
      .description-edit-field .field-hint{
        margin:0;
      }
    `;
    document.head.appendChild(style);
  }

  function showDescriptionModal(materialId) {
    const item = cache.get(materialId);
    if (!item || !String(item.description || '').trim()) return;

    const modal = document.querySelector('#modal');
    const backdrop = document.querySelector('#modalBackdrop');
    const title = document.querySelector('#modalTitle');
    const body = document.querySelector('#modalBody');

    if (!modal || !backdrop || !title || !body) return;

    title.textContent = item.title ? `Описание — ${item.title}` : 'Описание';
    body.innerHTML = `
      <div class="material-description-view">${esc(item.description)}</div>
      <div class="modal-actions">
        <button type="button" class="btn primary" id="descriptionCloseBtn">Закрыть</button>
      </div>
    `;

    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');

    document.querySelector('#descriptionCloseBtn')?.addEventListener('click', () => {
      backdrop.classList.add('hidden');
      modal.classList.add('hidden');
    });
  }

  function enhanceCards() {
    document
      .querySelectorAll('#materialsCards [data-edit-material]')
      .forEach((editButton) => {
        const materialId = editButton.dataset.editMaterial;
        const actions = editButton.closest('.material-actions');
        if (!materialId || !actions) return;

        let button = [...actions.querySelectorAll('[data-description-material]')]
          .find((x) => x.dataset.descriptionMaterial === materialId);

        const hasDescription = Boolean(
          String(cache.get(materialId)?.description || '').trim()
        );

        if (hasDescription && !button) {
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'small-btn material-description-btn';
          button.dataset.descriptionMaterial = materialId;
          button.textContent = 'Описание';
          actions.insertBefore(button, editButton);
        }

        if (!hasDescription && button) {
          button.remove();
        }
      });
  }

  async function refreshDescriptions() {
    clearTimeout(refreshTimer);

    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session) {
        refreshTimer = setTimeout(refreshDescriptions, 900);
        return;
      }

      const { data, error } = await client
        .from('materials')
        .select('id,title,description');

      if (error) throw error;

      cache.clear();
      for (const row of data || []) {
        cache.set(String(row.id), {
          id: String(row.id),
          title: row.title || '',
          description: row.description || ''
        });
      }

      enhanceCards();
    } catch (error) {
      console.warn('[Description UI] Cannot read descriptions:', error);
      refreshTimer = setTimeout(refreshDescriptions, 1500);
    }
  }

  async function refreshOne(materialId) {
    try {
      const { data, error } = await client
        .from('materials')
        .select('id,title,description')
        .eq('id', materialId)
        .single();

      if (error) throw error;

      cache.set(String(data.id), {
        id: String(data.id),
        title: data.title || '',
        description: data.description || ''
      });

      enhanceCards();
    } catch (error) {
      console.warn('[Description UI] Cannot refresh material:', error);
    }
  }

  function injectDescriptionField(materialId) {
    const form = document.querySelector('#materialForm');
    if (!form || !materialId) return;
    if (form.querySelector('textarea[name="description"]')) return;

    const notes = form.querySelector('textarea[name="notes"]');
    const notesField = notes?.closest('.field');
    if (!notesField) return;

    const field = document.createElement('div');
    field.className = 'field full description-edit-field';
    field.innerHTML = `
      <label>Описание</label>
      <textarea name="description" placeholder="Описание материала / текст публикации VK">${esc(cache.get(materialId)?.description || '')}</textarea>
      <p class="field-hint">Для материалов из VK сюда попадает текст поста после первой строки. «Заметки» ниже остаются отдельным внутренним полем.</p>
    `;

    notesField.parentNode.insertBefore(field, notesField);

    // Штатный app.js сохраняет все прежние поля.
    // Description сохраняем только ПОСЛЕ того, как штатное сохранение
    // успешно закрыло модальное окно.
    form.addEventListener('submit', () => {
      const description = form.querySelector('textarea[name="description"]')?.value ?? '';
      waitForCoreSaveAndStoreDescription(materialId, description);
    }, { once: true });
  }

  function waitForCoreSaveAndStoreDescription(materialId, description) {
    const started = Date.now();

    const poll = setInterval(async () => {
      const modal = document.querySelector('#modal');
      const form = document.querySelector('#materialForm');
      const submit = form?.querySelector('button[type="submit"]');

      // Штатный app.js закрывает modal только после успешного saveRecord().
      if (modal?.classList.contains('hidden')) {
        clearInterval(poll);

        try {
          const clean = String(description || '').trim();
          const { error } = await client
            .from('materials')
            .update({ description: clean || null })
            .eq('id', materialId);

          if (error) throw error;

          await refreshOne(materialId);
          toast('Описание сохранено ✓');
        } catch (error) {
          console.error('[Description UI] Description save failed:', error);
          toast('Материал сохранён, но описание сохранить не удалось.');
        } finally {
          activeEditMaterialId = null;
        }
        return;
      }

      // Если штатная кнопка снова активна, но окно осталось открытым,
      // значит основное сохранение завершилось ошибкой — description не трогаем.
      if (submit && !submit.disabled && Date.now() - started > 300) {
        clearInterval(poll);
        return;
      }

      if (Date.now() - started > 12000) {
        clearInterval(poll);
      }
    }, 100);
  }

  function watchMaterialCards() {
    const grid = document.querySelector('#materialsCards');
    if (!grid) return;

    const observer = new MutationObserver(() => {
      // Небольшая задержка, чтобы штатный renderMaterials успел завершиться.
      setTimeout(enhanceCards, 0);
    });

    observer.observe(grid, { childList: true, subtree: true });
  }

  document.addEventListener('click', (event) => {
    const descriptionButton = event.target.closest('[data-description-material]');
    if (descriptionButton) {
      event.preventDefault();
      showDescriptionModal(descriptionButton.dataset.descriptionMaterial);
      return;
    }

    const editButton = event.target.closest('[data-edit-material]');
    if (editButton) {
      activeEditMaterialId = editButton.dataset.editMaterial;
      setTimeout(() => injectDescriptionField(activeEditMaterialId), 0);
      return;
    }

    if (
      event.target.closest('#addMaterialBtn') ||
      event.target.closest('#quickAddBtn') ||
      event.target.closest('#cancelModal') ||
      event.target.closest('#modalClose')
    ) {
      activeEditMaterialId = null;
    }

    if (event.target.closest('#refreshBtn')) {
      setTimeout(refreshDescriptions, 250);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') activeEditMaterialId = null;
  });

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      setTimeout(refreshDescriptions, 250);
    }
    if (event === 'SIGNED_OUT') {
      cache.clear();
    }
  });

  installStyles();
  watchMaterialCards();
  setTimeout(refreshDescriptions, 350);
})();
