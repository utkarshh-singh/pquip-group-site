(async function () {
  const PER_PAGE = 24;

  const $ = s => document.querySelector(s);
  const resultsEl = $('#pub-results');
  const qEl = $('#q'), yearEl = $('#year'), authorEl = $('#author'), catEl = $('#category');
  const clearBtn = $('#clear'), loadMoreBtn = $('#load-more'), loadMoreWrap = $('#load-more-wrap');

  let allPubs = [];
  let filtered = [];
  let page = 0;

  const norm = t => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // ---------- fetch helpers with diagnostics ----------
  async function fetchJSON(path, label) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${label || path} HTTP ${res.status}`);
    try { return await res.json(); }
    catch { throw new Error(`${label || path} invalid JSON`); }
  }

  async function loadManifest() {
    const j = await fetchJSON('members/manifest.json', 'manifest.json');
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.members)) return j.members;
    throw new Error('manifest.json must be an array of ids or { "members": [...] }');
  }

  // Accept name as string OR array; return normalized profile
  async function loadProfile(id) {
    const p = await fetchJSON(`members/${encodeURIComponent(id)}/profile.json`, `${id}/profile.json`);

    let displayName = '';
    let aliases = [];
    if (Array.isArray(p.name) && p.name.length) {
      displayName = String(p.name[0]);
      aliases = p.name.slice(1).map(String);
    } else {
      displayName = String(p.name || id);
      aliases = Array.isArray(p.aliases) ? p.aliases.map(String) : [];
    }

    const categories =
      Array.isArray(p.categories) && p.categories.length ? p.categories.slice() :
      (Array.isArray(p.topics) ? p.topics.slice() : []);

    const photo = typeof p.photo === 'string' ? p.photo : null;

    return {
      id: p.id || id,
      name: displayName,
      aliases,
      categories,
      photo
    };
  }

  async function loadMemberPubs(id) {
    try {
      return await fetchJSON(`members/${encodeURIComponent(id)}/publications.json`, `${id}/publications.json`);
    } catch (e) {
      console.warn('[pubs] skipping', id, '-', e.message);
      return null;
    }
  }

  function keyFor(pub) {
    if (pub.doi) return `doi:${String(pub.doi).toLowerCase()}`;
    const t = norm(pub.title);
    return t ? `t:${t}` : `u:${(pub.year || '0')}:${Math.random().toString(36).slice(2, 8)}`;
  }

  // ======== Build everything ========
  async function loadAll() {
    // Manifest
    let ids;
    try { ids = await loadManifest(); }
    catch (e) {
      console.error('[pubs] manifest error:', e);
      resultsEl.innerHTML = `<p>Failed to load <code>members/manifest.json</code>: ${e.message}</p>`;
      return;
    }

    // Profiles
    const profiles = (await Promise.all(ids.map(async id => {
      try { return await loadProfile(id); }
      catch (e) { console.warn('[pubs] profile error:', id, e.message); return null; }
    }))).filter(Boolean);

    if (!profiles.length) {
      resultsEl.innerHTML = `<p>No valid profiles found. Check <code>members/*/profile.json</code>.</p>`;
      return;
    }

    // Map for quick photo/name lookup
    const profileById = new Map(profiles.map(p => [p.id, p]));

    // Author filter options
    authorEl.innerHTML = `<option value="">All authors (group)</option>` +
      profiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    // publications.json per member
    const pubsFiles = await Promise.all(
      profiles.map(async p => {
        const j = await loadMemberPubs(p.id);
        return { profile: p, json: j };
      })
    );

    // Merge
    const merged = new Map();

    for (const row of pubsFiles) {
      const pjson = row.json;
      if (!pjson || !Array.isArray(pjson.publications)) continue;

      for (const pub of pjson.publications) {
        const k = keyFor(pub);
        if (!merged.has(k)) {
          merged.set(k, {
            title: pub.title || '',
            year: pub.year ?? null,
            venue: pub.venue || '',
            doi: pub.doi || null,
            url: pub.url || '',
            authors: [...(pub.authors || [])], // full list (strings)
            groupAuthors: [],
            categories: []
          });
        } else {
          const it = merged.get(k);
          if (!it.doi && pub.doi) it.doi = pub.doi;
          if ((!it.venue || /arxiv/i.test(it.venue)) && pub.venue) it.venue = pub.venue;
          if (!it.url && pub.url) it.url = pub.url;
          it.authors = Array.from(new Set([...(it.authors || []), ...(pub.authors || [])]));
        }
      }
    }

    // Compute group co-authors + categories; attach photo for avatars
    const aliasTable = profiles.map(p => ({
      id: p.id,
      name: p.name,
      photo: p.photo || null,
      aliases: [p.name.toLowerCase(), ...p.aliases.map(a => a.toLowerCase())],
      categories: p.categories
    }));

    for (const [k, it] of merged.entries()) {
      const lowers = (it.authors || []).map(a => a.toLowerCase());
      const groupMatches = aliasTable.filter(a => a.aliases.some(al => lowers.includes(al)));
      it.groupAuthors = groupMatches.map(m => ({ id: m.id, name: m.name, photo: m.photo }));
      const cats = new Set();
      groupMatches.forEach(m => (m.categories || []).forEach(c => cats.add(c)));
      it.categories = [...cats];
    }

    // Final array + sort newest first
    allPubs = Array.from(merged.values())
      .sort((a, b) => (b.year || 0) - (a.year || 0) || (a.title || '').localeCompare(b.title || ''));

    // Filters: years + categories
    const years = [...new Set(allPubs.map(p => p.year).filter(Boolean))].sort((a, b) => b - a);
    yearEl.innerHTML = `<option value="">All years</option>` + years.map(y => `<option value="${y}">${y}</option>`).join('');

    const allCats = [...new Set(allPubs.flatMap(p => p.categories || []))].sort((a, b) => a.localeCompare(b));
    catEl.innerHTML = `<option value="">All categories</option>` + allCats.map(c => `<option value="${c}">${c}</option>`).join('');

    applyFilters(true);
  }

  // ======== Render (compact) ========
  function initials(name){
    const parts = String(name || '').trim().split(/\s+/);
    const first = parts[0]?.[0] || '';
    const last  = parts.length>1 ? parts[parts.length-1][0] : '';
    return (first + last).toUpperCase();
  }

  function render(items, append = false) {
    if (!append) { resultsEl.innerHTML = ''; page = 0; }
    const start = page * PER_PAGE;
    const slice = items.slice(start, start + PER_PAGE);

    const html = slice.map(p => {
      // Build authors avatars (group members only). Fallback to small names if none.
      let authorsHtml = '';
      if (p.groupAuthors && p.groupAuthors.length){
        const avatars = p.groupAuthors.map(a => {
          if (a.photo) {
            return `<img class="avatar" src="${a.photo}" alt="${a.name}" title="${a.name}">`;
          } else {
            // fallback "initials bubble" using SVG
            const text = initials(a.name);
            return `
              <svg class="avatar" viewBox="0 0 40 40" role="img" aria-label="${a.name}" title="${a.name}">
                <circle cx="20" cy="20" r="19" fill="#e9edf5" stroke="#fff"/>
                <text x="50%" y="54%" text-anchor="middle" font-size="16" fill="#4a5b7a" font-family="Inter, system-ui" dominant-baseline="middle">${text}</text>
              </svg>`;
          }
        }).join('');
        authorsHtml = `<div class="authors"><div class="author-avatars">${avatars}</div></div>`;
      } else {
        // show small textual authors list (trim to 3)
        const names = (p.authors || []).slice(0,3).join(', ');
        authorsHtml = names ? `<div class="authors"><span class="author-names">${names}${(p.authors||[]).length>3?' <span class="sep">…</span>':''}</span></div>` : '';
      }

      return `
        <article class="pub-card" data-doi="${p.doi||''}">
          <h3 class="pub-title"><a href="${p.url || '#'}" target="_blank" rel="noopener">${p.title}</a></h3>
          <div class="pub-meta">
            ${(p.venue ? `<em>${p.venue}</em>` : '')}${p.venue && p.year ? ' • ' : ''}${p.year || ''}
          </div>
          ${authorsHtml}
        </article>
      `;
    }).join('');

    resultsEl.insertAdjacentHTML('beforeend', html);
    page++;
    if (items.length > page * PER_PAGE) loadMoreWrap.classList.remove('hidden');
    else loadMoreWrap.classList.add('hidden');
  }

  // ======== Filter logic (unchanged) ========
  function applyFilters(reset = false) {
    const q = norm(qEl.value);
    const y = yearEl.value;
    const m = authorEl.value;
    const c = catEl.value;

    filtered = allPubs.filter(p => {
      const byYear = !y || String(p.year || '') === y;
      const byMember = !m || (p.groupAuthors || []).some(a => a.id === m);
      const byCat = !c || (p.categories || []).includes(c);
      const byText = !q || norm(p.title).includes(q) || norm(p.venue).includes(q) ||
        (p.groupAuthors || []).some(a => norm(a.name).includes(q));
      return byYear && byMember && byCat && byText;
    });

    render(filtered, !reset && page > 0);
  }

  // events
  qEl.addEventListener('input', () => applyFilters(true));
  yearEl.addEventListener('change', () => applyFilters(true));
  authorEl.addEventListener('change', () => applyFilters(true));
  catEl.addEventListener('change', () => applyFilters(true));
  clearBtn.addEventListener('click', () => { qEl.value = ''; yearEl.value = ''; authorEl.value = ''; catEl.value = ''; applyFilters(true); });
  loadMoreBtn.addEventListener('click', () => render(filtered, true));

  // go
  try { await loadAll(); }
  catch (e) {
    console.error('[pubs] fatal:', e);
    resultsEl.innerHTML = `<p>Failed to load publications.<br>${e.message}</p>`;
  }
})();
