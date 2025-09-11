(async function () {
  const PER_PAGE = 24;

  const $ = s => document.querySelector(s);
  const resultsEl = $('#pub-results');
  const qEl = $('#q'), yearEl = $('#year'), authorEl = $('#author'), catEl = $('#category');
  const clearBtn = $('#clear'), loadMoreBtn = $('#load-more'), loadMoreWrap = $('#load-more-wrap');

  let allPubs = [], filtered = []; let page = 0;
  const norm = t => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const bust = () => `?_=${Date.now()}`;

  async function fetchJSON(path, label) {
    const res = await fetch(path + bust(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`${label || path} HTTP ${res.status}`);
    try { return await res.json(); }
    catch { throw new Error(`${label || path} invalid JSON`); }
  }

  async function loadManifest() {
    const j = await fetchJSON('members/manifest.json', 'manifest.json');
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.members)) return j.members;
    throw new Error('manifest.json must be an array or { "members": [...] }');
  }

  // Normalize profile: name can be string OR array; keep photo & categories
  async function loadProfile(id) {
    const p = await fetchJSON(`members/${encodeURIComponent(id)}/profile.json`, `${id}/profile.json`);
    let displayName = '', aliases = [];
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
    return { id: p.id || id, name: displayName, aliases, categories, photo };
  }

  // publications.json may be:
  // { publications: [...] }  OR  [...]
  async function loadMemberPubs(id) {
    try {
      const j = await fetchJSON(`members/${encodeURIComponent(id)}/publications.json`, `${id}/publications.json`);
      if (Array.isArray(j)) return j;
      if (j && Array.isArray(j.publications)) return j.publications;
      console.warn('[pubs] publications.json has no array for', id);
      return [];
    } catch (e) {
      console.warn('[pubs] skipping', id, '-', e.message);
      return [];
    }
  }

  const keyFor = pub => pub.doi ? `doi:${String(pub.doi).toLowerCase()}`
                                : (norm(pub.title) ? `t:${norm(pub.title)}` : `u:${(pub.year||'0')}:${Math.random().toString(36).slice(2,8)}`);

  function initials(name){
    const parts = String(name||'').trim().split(/\s+/);
    const a=parts[0]?.[0]||'', b=parts.length>1?parts.at(-1)[0]:'';
    return (a+b).toUpperCase();
  }

  async function loadAll() {
    // Manifest + profiles
    const ids = await loadManifest();
    const profiles = (await Promise.all(ids.map(id => loadProfile(id).catch(e => (console.warn('[pubs] profile',id,e.message), null))))).filter(Boolean);
    if (!profiles.length) { resultsEl.innerHTML = `<p>No valid profiles found.</p>`; return; }

    // author filter options
    authorEl.innerHTML = `<option value="">All authors (group)</option>` + profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

    // Load local pubs for each member
    const perMember = await Promise.all(profiles.map(async p => ({ profile: p, pubs: await loadMemberPubs(p.id) })));

    // Merge by DOI/title
    const merged = new Map();
    for (const {pubs} of perMember) {
      for (const pub of pubs) {
        const k = keyFor(pub);
        if (!merged.has(k)) {
          merged.set(k, {
            title: pub.title || '',
            year: pub.year ?? null,
            venue: pub.venue || '',
            doi:  pub.doi || null,
            url:  pub.url || '',
            authors: [...(pub.authors||[])],
            groupAuthors: [],
            categories: []
          });
        } else {
          const it = merged.get(k);
          if (!it.doi && pub.doi) it.doi = pub.doi;
          if ((!it.venue || /arxiv/i.test(it.venue)) && pub.venue) it.venue = pub.venue;
          if (!it.url && pub.url) it.url = pub.url;
          it.authors = Array.from(new Set([...(it.authors||[]), ...(pub.authors||[])]));
        }
      }
    }

    // Match group authors (with photos) + categories from profiles
    const aliasTable = profiles.map(p => ({
      id: p.id, name: p.name, photo: p.photo || null,
      aliases: [p.name.toLowerCase(), ...p.aliases.map(a=>a.toLowerCase())],
      categories: p.categories
    }));

    for (const it of merged.values()) {
      const lowers = (it.authors||[]).map(a=>a.toLowerCase());
      const matches = aliasTable.filter(a => a.aliases.some(al => lowers.includes(al)));
      it.groupAuthors = matches.map(m => ({ id:m.id, name:m.name, photo:m.photo }));
      const cats = new Set(); matches.forEach(m => (m.categories||[]).forEach(c => cats.add(c)));
      it.categories = [...cats];
    }

    allPubs = Array.from(merged.values())
      .sort((a,b)=>(b.year||0)-(a.year||0) || (a.title||'').localeCompare(b.title||''));

    const years = [...new Set(allPubs.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a);
    yearEl.innerHTML = `<option value="">All years</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
    const allCats = [...new Set(allPubs.flatMap(p=>p.categories||[]))].sort((a,b)=>a.localeCompare(b));
    catEl.innerHTML = `<option value="">All categories</option>` + allCats.map(c=>`<option value="${c}">${c}</option>`).join('');

    applyFilters(true);
  }

  function render(items, append=false){
    if(!append){ resultsEl.innerHTML=''; page=0; }
    const start = page*24; const slice = items.slice(start, start+24);
    const html = slice.map(p => {
      let authorsHtml = '';
      if (p.groupAuthors?.length){
        const avatars = p.groupAuthors.map(a => a.photo
          ? `<img class="avatar" src="${a.photo}" alt="${a.name}" title="${a.name}">`
          : `<svg class="avatar" viewBox="0 0 40 40" role="img" aria-label="${a.name}" title="${a.name}">
               <circle cx="20" cy="20" r="19" fill="#e9edf5" stroke="#fff"/>
               <text x="50%" y="54%" text-anchor="middle" font-size="16" fill="#4a5b7a" font-family="Inter, system-ui" dominant-baseline="middle">${initials(a.name)}</text>
             </svg>`
        ).join('');
        authorsHtml = `<div class="authors"><div class="author-avatars">${avatars}</div></div>`;
      } else {
        const names = (p.authors||[]).slice(0,3).join(', ');
        authorsHtml = names ? `<div class="authors"><span class="author-names">${names}${(p.authors||[]).length>3?' <span class="sep">…</span>':''}</span></div>` : '';
      }
      return `
        <article class="pub-card">
          <h3 class="pub-title"><a href="${p.url||'#'}" target="_blank" rel="noopener">${p.title}</a></h3>
          <div class="pub-meta">${p.venue ? `<em>${p.venue}</em>` : ''}${p.venue&&p.year?' • ':''}${p.year||''}</div>
          ${authorsHtml}
        </article>`;
    }).join('');
    resultsEl.insertAdjacentHTML('beforeend', html);
    page++;
    if(items.length > page*24) loadMoreWrap.classList.remove('hidden'); else loadMoreWrap.classList.add('hidden');
  }

  function applyFilters(reset=false){
    const q=norm(qEl.value), y=yearEl.value, m=authorEl.value, c=catEl.value;
    filtered = allPubs.filter(p=>{
      const byYear = !y || String(p.year||'')===y;
      const byMember = !m || (p.groupAuthors||[]).some(a=>a.id===m);
      const byCat = !c || (p.categories||[]).includes(c);
      const byText = !q || norm(p.title).includes(q) || norm(p.venue).includes(q) || (p.groupAuthors||[]).some(a=>norm(a.name).includes(q));
      return byYear && byMember && byCat && byText;
    });
    render(filtered, !reset && page>0);
  }

  qEl.addEventListener('input', ()=>applyFilters(true));
  yearEl.addEventListener('change', ()=>applyFilters(true));
  authorEl.addEventListener('change', ()=>applyFilters(true));
  catEl.addEventListener('change', ()=>applyFilters(true));
  clearBtn.addEventListener('click', ()=>{ qEl.value=''; yearEl.value=''; authorEl.value=''; catEl.value=''; applyFilters(true); });
  loadMoreBtn.addEventListener('click', ()=>render(filtered, true));

  try { await loadAll(); }
  catch (e) { console.error('[pubs] fatal:', e); resultsEl.innerHTML = `<p>Failed to load publications.<br>${e.message}</p>`; }
})();
