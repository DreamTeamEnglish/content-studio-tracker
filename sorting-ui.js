/* =========================================================
   CONTENT STUDIO TRACKER v1.6 — SORTING UI ADD-ON

   Добавляет:
   МАТЕРИАЛЫ
   - по дате добавления в Tracker (materials.created_at)
   - по дате публикации (последняя активная; если активной нет —
     последняя историческая)
   - ↑ / ↓

   ПУБЛИКАЦИИ
   - дата публикации
   - просмотры
   - лайки
   - комментарии
   - репосты
   - ↑ / ↓

   Сортировка применяется к уже отфильтрованным/найденным карточкам.
   Рабочий app.js не изменяется.
   ========================================================= */

(() => {
  'use strict';

  const CFG = window.CONTENT_STUDIO_CONFIG || {};
  const validConfig =
    /^https:\/\/.+\.supabase\.co$/i.test(CFG.SUPABASE_URL || '') &&
    /^(sb_publishable_|eyJ)/.test(CFG.SUPABASE_PUBLISHABLE_KEY || '');

  if (!window.supabase || !validConfig) {
    console.warn('[Sorting UI] Supabase config not found.');
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

  const STORE = {
    materialKey: 'cst_sort_materials_key',
    materialDir: 'cst_sort_materials_dir',
    publicationKey: 'cst_sort_publications_key',
    publicationDir: 'cst_sort_publications_dir'
  };

  const sortState = {
    materials: {
      key: localStorage.getItem(STORE.materialKey) || 'publication_date',
      dir: localStorage.getItem(STORE.materialDir) || 'desc'
    },
    publications: {
      key: localStorage.getItem(STORE.publicationKey) || 'publication_date',
      dir: localStorage.getItem(STORE.publicationDir) || 'desc'
    }
  };

  const cache = {
    materialAddedAt: new Map(),
    materialPublicationDate: new Map(),
    publicationDate: new Map(),
    latestStats: new Map()
  };

  let metadataReady = false;
  let loadingPromise = null;
  let applyTimer = null;
  let observerMaterials = null;
  let observerPublications = null;

  function installStyles() {
    if (document.querySelector('#sortingUiStyles')) return;

    const style = document.createElement('style');
    style.id = 'sortingUiStyles';
    style.textContent = `
      .tracker-sort{
        display:flex;
        align-items:center;
        gap:8px;
        min-width:0;
      }
      .tracker-sort__label{
        color:#65758d;
        font-size:12px;
        font-weight:800;
        letter-spacing:.06em;
        text-transform:uppercase;
        white-space:nowrap;
      }
      .tracker-sort select{
        min-width:178px;
        max-width:220px;
      }
      .tracker-sort__direction{
        min-width:42px;
        height:42px;
        padding:0 12px;
        font-size:18px;
        line-height:1;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border:1px solid rgba(13,52,94,.42);
        border-radius:12px;
        background:#fff;
        color:#123f78;
        cursor:pointer;
        transition:.18s ease;
      }
      .tracker-sort__direction:hover{
        border-color:#c99b37;
        color:#8a6716;
        transform:translateY(-1px);
      }
      .tracker-sort__direction:disabled{
        opacity:.55;
        cursor:wait;
        transform:none;
      }
      @media(max-width:760px){
        .tracker-sort{
          width:100%;
          flex-wrap:wrap;
        }
        .tracker-sort select{
          flex:1;
          max-width:none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  async function fetchAll(table, columns) {
    const PAGE = 1000;
    const rows = [];

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from(table)
        .select(columns)
        .range(from, from + PAGE - 1);

      if (error) throw error;

      rows.push(...(data || []));

      if (!data || data.length < PAGE) break;
    }

    return rows;
  }

  function newerStat(a, b) {
    if (!a) return b;
    if (!b) return a;

    const da = String(a.snapshot_date || '');
    const db = String(b.snapshot_date || '');

    if (da !== db) return db > da ? b : a;

    const ca = String(a.created_at || '');
    const cb = String(b.created_at || '');

    return cb > ca ? b : a;
  }

  async function loadMetadata(force = false) {
    if (loadingPromise && !force) return loadingPromise;

    loadingPromise = (async () => {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session) {
        metadataReady = false;
        return;
      }

      const [materials, publications, stats] = await Promise.all([
        fetchAll('materials', 'id,created_at'),
        fetchAll(
          'publications',
          'id,material_id,publication_date,status,created_at'
        ),
        fetchAll(
          'post_stats',
          'id,publication_id,snapshot_date,created_at,views,likes,comments,reposts'
        )
      ]);

      cache.materialAddedAt.clear();
      cache.materialPublicationDate.clear();
      cache.publicationDate.clear();
      cache.latestStats.clear();

      for (const material of materials) {
        cache.materialAddedAt.set(
          String(material.id),
          material.created_at || null
        );
      }

      const pubsByMaterial = new Map();

      for (const publication of publications) {
        const pubId = String(publication.id);
        const materialId = String(publication.material_id);

        cache.publicationDate.set(
          pubId,
          publication.publication_date || null
        );

        if (!pubsByMaterial.has(materialId)) {
          pubsByMaterial.set(materialId, []);
        }

        pubsByMaterial.get(materialId).push(publication);
      }

      for (const [materialId, pubs] of pubsByMaterial.entries()) {
        const withDate = pubs
          .filter((p) => p.publication_date)
          .sort((a, b) =>
            String(b.publication_date || '')
              .localeCompare(String(a.publication_date || ''))
          );

        const active = withDate.filter(
          (p) => p.status === 'published'
        );

        const chosen = active[0] || withDate[0] || null;

        cache.materialPublicationDate.set(
          materialId,
          chosen?.publication_date || null
        );
      }

      for (const stat of stats) {
        const publicationId = String(stat.publication_id);
        const current = cache.latestStats.get(publicationId) || null;
        cache.latestStats.set(
          publicationId,
          newerStat(current, stat)
        );
      }

      metadataReady = true;
      applyAll();
    })()
      .catch((error) => {
        metadataReady = false;
        console.warn('[Sorting UI] Metadata load failed:', error);
      })
      .finally(() => {
        loadingPromise = null;
      });

    return loadingPromise;
  }

  function materialIdFromCard(card) {
    return (
      card.querySelector('[data-edit-material]')?.dataset.editMaterial ||
      card.querySelector('[data-delete-material]')?.dataset.deleteMaterial ||
      ''
    );
  }

  function publicationIdFromCard(card) {
    return (
      card.querySelector('[data-edit-pub]')?.dataset.editPub ||
      card.querySelector('[data-stat-pub]')?.dataset.statPub ||
      card.querySelector('[data-remove-pub]')?.dataset.removePub ||
      card.querySelector('[data-delete-pub]')?.dataset.deletePub ||
      ''
    );
  }

  function metricForPublication(publicationId, key) {
    if (key === 'publication_date') {
      return cache.publicationDate.get(publicationId) || null;
    }

    const stat = cache.latestStats.get(publicationId);

    if (!stat) return null;

    return Number(stat[key] ?? 0);
  }

  function valueForMaterial(materialId, key) {
    if (key === 'added_at') {
      return cache.materialAddedAt.get(materialId) || null;
    }

    return cache.materialPublicationDate.get(materialId) || null;
  }

  function compareValues(a, b, dir) {
    const aMissing = a === null || a === undefined || a === '';
    const bMissing = b === null || b === undefined || b === '';

    // Пустые значения всегда в конце — и при ↑, и при ↓.
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    let result;

    if (typeof a === 'number' && typeof b === 'number') {
      result = a - b;
    } else {
      result = String(a).localeCompare(String(b));
    }

    return dir === 'asc' ? result : -result;
  }

  function reorderCards(container, cards, getId, getValue, dir) {
    if (!container || cards.length < 2) return;

    const indexed = cards.map((card, index) => ({
      card,
      index,
      id: String(getId(card) || '')
    }));

    const sorted = [...indexed].sort((a, b) => {
      const result = compareValues(
        getValue(a.id),
        getValue(b.id),
        dir
      );

      return result || a.index - b.index;
    });

    const changed = sorted.some(
      (item, index) => item.card !== cards[index]
    );

    if (!changed) return;

    const fragment = document.createDocumentFragment();

    for (const item of sorted) {
      fragment.appendChild(item.card);
    }

    container.appendChild(fragment);
  }

  function applyMaterialsSort() {
    if (!metadataReady) return;

    const container = document.querySelector('#materialsCards');
    if (!container) return;

    const cards = [
      ...container.querySelectorAll(':scope > .material-card')
    ];

    const { key, dir } = sortState.materials;

    reorderCards(
      container,
      cards,
      materialIdFromCard,
      (id) => valueForMaterial(id, key),
      dir
    );
  }

  function applyPublicationsSort() {
    if (!metadataReady) return;

    const container = document.querySelector('#publicationsList');
    if (!container) return;

    const cards = [
      ...container.querySelectorAll(':scope > .publication-card')
    ];

    const { key, dir } = sortState.publications;

    reorderCards(
      container,
      cards,
      publicationIdFromCard,
      (id) => metricForPublication(id, key),
      dir
    );
  }

  function applyAll() {
    clearTimeout(applyTimer);

    applyTimer = setTimeout(() => {
      applyMaterialsSort();
      applyPublicationsSort();
      syncControls();
    }, 0);
  }

  function directionTitle(section) {
    const { key, dir } = sortState[section];
    const descending = dir === 'desc';

    if (
      section === 'publications' &&
      ['views', 'likes', 'comments', 'reposts'].includes(key)
    ) {
      return descending
        ? 'Сейчас: больше → меньше. Нажмите для меньше → больше.'
        : 'Сейчас: меньше → больше. Нажмите для больше → меньше.';
    }

    return descending
      ? 'Сейчас: новые → старые. Нажмите для старые → новые.'
      : 'Сейчас: старые → новые. Нажмите для новые → старые.';
  }

  function syncControls() {
    const materialSelect =
      document.querySelector('#materialsSortKey');
    const materialDir =
      document.querySelector('#materialsSortDir');
    const publicationSelect =
      document.querySelector('#publicationsSortKey');
    const publicationDir =
      document.querySelector('#publicationsSortDir');

    if (materialSelect) {
      materialSelect.value = sortState.materials.key;
    }

    if (materialDir) {
      materialDir.textContent =
        sortState.materials.dir === 'desc' ? '↓' : '↑';
      materialDir.title = directionTitle('materials');
      materialDir.setAttribute(
        'aria-label',
        materialDir.title
      );
    }

    if (publicationSelect) {
      publicationSelect.value = sortState.publications.key;
    }

    if (publicationDir) {
      publicationDir.textContent =
        sortState.publications.dir === 'desc' ? '↓' : '↑';
      publicationDir.title = directionTitle('publications');
      publicationDir.setAttribute(
        'aria-label',
        publicationDir.title
      );
    }
  }

  function saveSortState() {
    localStorage.setItem(
      STORE.materialKey,
      sortState.materials.key
    );
    localStorage.setItem(
      STORE.materialDir,
      sortState.materials.dir
    );
    localStorage.setItem(
      STORE.publicationKey,
      sortState.publications.key
    );
    localStorage.setItem(
      STORE.publicationDir,
      sortState.publications.dir
    );
  }

  function createSortControls(section) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tracker-sort';
    wrapper.dataset.sortSection = section;

    if (section === 'materials') {
      wrapper.innerHTML = `
        <span class="tracker-sort__label">Сортировка</span>
        <select id="materialsSortKey" aria-label="Сортировка материалов">
          <option value="publication_date">Дата публикации</option>
          <option value="added_at">Добавлено в Tracker</option>
        </select>
        <button
          type="button"
          id="materialsSortDir"
          class="tracker-sort__direction"
        >↓</button>
      `;
    } else {
      wrapper.innerHTML = `
        <span class="tracker-sort__label">Сортировка</span>
        <select id="publicationsSortKey" aria-label="Сортировка публикаций">
          <option value="publication_date">Дата публикации</option>
          <option value="views">Просмотры</option>
          <option value="likes">Лайки</option>
          <option value="comments">Комментарии</option>
          <option value="reposts">Репосты</option>
        </select>
        <button
          type="button"
          id="publicationsSortDir"
          class="tracker-sort__direction"
        >↓</button>
      `;
    }

    return wrapper;
  }

  function installControls() {
    const materialToolbar =
      document.querySelector('#page-materials .toolbar');

    if (
      materialToolbar &&
      !document.querySelector('[data-sort-section="materials"]')
    ) {
      const controls = createSortControls('materials');
      const addButton =
        materialToolbar.querySelector('#addMaterialBtn');

      materialToolbar.insertBefore(
        controls,
        addButton || null
      );
    }

    const publicationToolbar =
      document.querySelector('#page-publications .toolbar');

    if (
      publicationToolbar &&
      !document.querySelector('[data-sort-section="publications"]')
    ) {
      const controls = createSortControls('publications');
      const addButton =
        publicationToolbar.querySelector('#addPublicationBtn');

      publicationToolbar.insertBefore(
        controls,
        addButton || null
      );
    }

    const materialSelect =
      document.querySelector('#materialsSortKey');
    const materialDir =
      document.querySelector('#materialsSortDir');
    const publicationSelect =
      document.querySelector('#publicationsSortKey');
    const publicationDir =
      document.querySelector('#publicationsSortDir');

    if (materialSelect && !materialSelect.dataset.sortBound) {
      materialSelect.dataset.sortBound = '1';

      materialSelect.addEventListener('change', async () => {
        sortState.materials.key = materialSelect.value;
        saveSortState();
        await loadMetadata(true);
        applyMaterialsSort();
        syncControls();
      });
    }

    if (materialDir && !materialDir.dataset.sortBound) {
      materialDir.dataset.sortBound = '1';

      materialDir.addEventListener('click', () => {
        sortState.materials.dir =
          sortState.materials.dir === 'desc' ? 'asc' : 'desc';

        saveSortState();
        applyMaterialsSort();
        syncControls();
      });
    }

    if (
      publicationSelect &&
      !publicationSelect.dataset.sortBound
    ) {
      publicationSelect.dataset.sortBound = '1';

      publicationSelect.addEventListener(
        'change',
        async () => {
          sortState.publications.key =
            publicationSelect.value;

          saveSortState();
          await loadMetadata(true);
          applyPublicationsSort();
          syncControls();
        }
      );
    }

    if (
      publicationDir &&
      !publicationDir.dataset.sortBound
    ) {
      publicationDir.dataset.sortBound = '1';

      publicationDir.addEventListener('click', () => {
        sortState.publications.dir =
          sortState.publications.dir === 'desc'
            ? 'asc'
            : 'desc';

        saveSortState();
        applyPublicationsSort();
        syncControls();
      });
    }

    syncControls();
  }

  function observeLists() {
    const materials = document.querySelector('#materialsCards');
    const publications =
      document.querySelector('#publicationsList');

    if (materials && !observerMaterials) {
      observerMaterials = new MutationObserver(() => {
        applyAll();
      });

      observerMaterials.observe(materials, {
        childList: true
      });
    }

    if (publications && !observerPublications) {
      observerPublications = new MutationObserver(() => {
        applyAll();
      });

      observerPublications.observe(publications, {
        childList: true
      });
    }
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('#refreshBtn')) {
      setTimeout(() => loadMetadata(true), 300);
    }
  });

  client.auth.onAuthStateChange((event) => {
    if (
      event === 'SIGNED_IN' ||
      event === 'INITIAL_SESSION' ||
      event === 'TOKEN_REFRESHED'
    ) {
      setTimeout(() => loadMetadata(true), 250);
    }

    if (event === 'SIGNED_OUT') {
      metadataReady = false;
      cache.materialAddedAt.clear();
      cache.materialPublicationDate.clear();
      cache.publicationDate.clear();
      cache.latestStats.clear();
    }
  });

  installStyles();
  installControls();
  observeLists();

  setTimeout(() => {
    installControls();
    observeLists();
    loadMetadata(true);
  }, 350);
})();
