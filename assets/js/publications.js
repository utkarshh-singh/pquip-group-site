(async function(){
  // ======== Config ========
  const PER_MEMBER = 10;                // how many latest per member to fetch
  const PAGE_SIZE  = 24;                // render page size
  const CACHE_TTL  = 24*60*60*1000;     // 1 day in ms

  // ======== Shorthands ========
  const $ = s => document.querySelector(s);
  const resultsEl = $('#pub-results');
  const qEl = $('#q'), yearEl = $('#year'), authorEl = $('#author'), catEl = $('#category');
  const clearBtn = $('#clear'), loadMoreBtn = $('#load-more'), loadMoreWrap = $('#load-more-wrap');

  // ======== State ========
  let allPubs = [];     // merged unique papers
  let filtered = [];    // filtered view
  let page = 0;

  // ======== Utils ========
  const normalize = t => (t||'').toLowerCase().replace(/\s+/g,' ').trim();
  const cacheKey = id => `pubs:${id}`;
  const getCache = id => { try{ const x = JSON.parse(localStorage.getItem(cacheKey(id))||'null'); return x && (Date.now()-x.ts<CACHE_TTL) ? x.data : null }catch{ return null } };
  const setCache = (id,data) => { try{ localStorage.setItem(cacheKey(id), JSON.stringify({ts:Date.now(), data})) }catch{} };
  const doiFromUrl = url => url && url.startsWith('https://doi.org/') ? url.slice('https://doi.org/'.length) : null;

  // Build a key for merging duplicates (prefer DOI)
  const keyFromRaw = p => {
    const doi = p?.externalIds?.DOI;
    if (doi) return `doi:${String(doi).toLowerCase()}`;
    const t = normalize(p?.title||'');
    return t ? `t:${t}` : `u:${(p?.year||'0')}:${Math.random().toString(36).slice(2,8)}`;
  };

  // ======== Data loading ========
  async function loadManifest(){
    const r = await fetch('members/manifest.json', {cache:'no-store'});
    if(!r.ok) throw new Error('manifest missing');
    return r.json(); // ["khabat","utkarsh",...]
  }
  async function loadProfile(id){
    const r = await fetch(`members/${encodeURIComponent(id)}/profile.json`, {cache:'no-store'});
    if(!r.ok) throw new Error(`profile missing: ${id}`);
    return r.json();
  }

  async function fetchS2(authorId, count=PER_MEMBER){
    const fields = 'papers.title,papers.year,papers.venue,papers.url,papers.externalIds,papers.authors';
    const url = `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}?fields=${fields}`;
    const r = await fetch(url);
    if(!r.ok) throw new Error(`S2 ${r.status}`);
    const j = await r.json();
    return (j.papers||[])
      .filter(Boolean)
      .sort((a,b)=>(b.year||0)-(a.year||0))
      .slice(0, count);
  }

  async function getMemberPubs(profile){
    const cached = getCache(profile.id);
    if(cached) return cached;
    if(!profile.semanticScholarId) return [];
    try{
      const raw = await fetchS2(profile.semanticScholarId, PER_MEMBER);
      const pubs = raw.map(p => ({
        _key: keyFromRaw(p),
        title: p.title || '',
        year: p.year ?? null,
        venue: p.venue || '',
        url:  (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : p.url || '#'),
        doi:  p.externalIds?.DOI || null,
        authors: (p.authors||[]).map(a=>a.name).filter(Boolean)   // list of author names (strings)
      }));
      setCache(profile.id, pubs);
      return pubs;
    }catch{ return []; }
  }

  // Free journal enrichment via Crossref/OpenAlex (uses DOI if present)
  async function enrichJournal(item){
    if (!item.doi) return item;
    const k = `jrnl:${item.doi.toLowerCase()}`;
    try{
      const cached = JSON.parse(localStorage.getItem(k) || 'null');
      if(cached){ item.venue = cached.venue || item.venue; item.url = cached.url || item.url; return item; }

      let venue='', url=item.url;
      const cr = await fetch(`https://api.crossref.org/works/${encodeURIComponent(item.doi)}`);
      if (cr.ok){
        const j = await cr.json();
        venue = (j.message['container-title'] && j.message['container-title'][0]) || venue;
        url   = j.message.URL || url;
      } else {
        const oa = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(item.doi)}`);
        if (oa.ok){
          const k2 = await oa.json();
          venue = k2.host_venue?.display_name || venue;
          url   = k2.primary_location?.source?.landing_page_url || url;
        }
      }
      localStorage.setItem(k, JSON.stringify({venue, url}));
      item.venue = venue || item.venue;
      item.url   = url   || item.url;
    }catch{}
    return item;
  }

  // ======== Aggregate & build filters ========
  async function loadAll(){
    const ids = await loadManifest();

    // load profiles in parallel
    const profiles = (await Promise.all(ids.map(id => loadProfile(id).catch(()=>null)))).filter(Boolean);

    // prepare author & category universes
    const nameToMember = new Map(profiles.map(p => [p.name.toLowerCase(), {id:p.id, name:p.name}]));
    const memberAliases = profiles.map(p => ({
      id: p.id,
      name: p.name,
      aliases: [p.name.toLowerCase(), ...(p.aliases||[]).map(a=>a.toLowerCase())],
      categories: (p.categories && p.categories.length ? p.categories : (p.topics||[])) || []
    }));

    // populate Author filter (list all group members)
    authorEl.innerHTML = `<option value="">All authors (group)</option>` +
      profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

    // fetch pubs for all members (parallel)
    const perMember = await Promise.all(
      profiles.map(p => getMemberPubs(p).then(list => ({profile:p, pubs:list})))
    );

    // merge duplicates by DOI/title; compute groupAuthors + categories
    const merged = new Map();
    for (const {pubs} of perMember){
      for (const pub of pubs){
        let key = pub._key;
        if (merged.has(key)){
          // merge minimal fields
          const it = merged.get(key);
          if (!it.doi && pub.doi) it.doi = pub.doi;
          if ((!it.venue || /arxiv/i.test(it.venue)) && pub.venue) it.venue = pub.venue;
          if (it.url?.startsWith('#') && pub.url) it.url = pub.url;
          it.authors = Array.from(new Set([...(it.authors||[]), ...(pub.authors||[])]));
        } else {
          merged.set(key, {...pub});
        }
      }
    }

    // attach groupAuthors + categories (union)
    for (const [k, it] of merged.entries()){
      const lowers = (it.authors||[]).map(a=>a.toLowerCase());
      const groupAuthors = memberAliases.filter(ma => ma.aliases.some(al => lowers.includes(al)));
      it.groupAuthors = groupAuthors.map(g => ({id:g.id, name:g.name}));
      // union of categories from all matched group authors
      const cats = new Set();
      groupAuthors.forEach(g => (g.categories||[]).forEach(c => cats.add(c)));
      it.categories = [...cats];
    }

    // final array
    allPubs = Array.from(merged.values())
      .sort((a,b)=> (b.year||0)-(a.year||0) || (a.title||'').localeCompare(b.title||''));

    // filters: years + categories
    const years = [...new Set(allPubs.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a);
    yearEl.innerHTML = `<option value="">All years</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');

    const allCats = [...new Set(allPubs.flatMap(p => p.categories || []))].sort((a,b)=>a.localeCompare(b));
    catEl.innerHTML = `<option value="">All categories</option>` + allCats.map(c=>`<option value="${c}">${c}</option>`).join('');

    await applyFilters(true);
  }

  // ======== Render & filter ========
  function render(items, append=false){
    if(!append){ resultsEl.innerHTML=''; page = 0; }
    const start = page * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    const html = slice.map(p => `
      <article class="pub-card">
        <h3 class="pub-title"><a href="${p.url||'#'}" target="_blank" rel="noopener">${p.title}</a></h3>
        <div class="pub-meta">
          ${(p.venue ? `<em>${p.venue}</em>` : '')}${p.venue && p.year ? ' • ' : ''}${p.year || ''}
          ${p.doi ? ` • <a href="https://doi.org/${p.doi}" target="_blank" rel="noopener">DOI</a>` : ''}
        </div>
        <div class="badges">
          ${(p.groupAuthors||[]).map(a=>`<span class="badge">Author: ${a.name}</span>`).join('')}
          ${(p.categories||[]).map(c=>`<span class="badge badge--category">${c}</span>`).join('')}
        </div>
      </article>
    `).join('');

    resultsEl.insertAdjacentHTML('beforeend', html);
    page++;
    if(items.length > page * PAGE_SIZE) loadMoreWrap.classList.remove('hidden');
    else loadMoreWrap.classList.add('hidden');
  }

  async function applyFilters(reset=false){
    const q = normalize(qEl.value);
    const y = yearEl.value;
    const m = authorEl.value;
    const c = catEl.value;

    filtered = allPubs.filter(p=>{
      const byYear = !y || String(p.year||'') === y;
      const byMember = !m || (p.groupAuthors||[]).some(a => a.id === m);
      const byCat = !c || (p.categories||[]).includes(c);
      const byText = !q || normalize(p.title).includes(q) || normalize(p.venue).includes(q) ||
                     (p.groupAuthors||[]).some(a => normalize(a.name).includes(q));
      return byYear && byMember && byCat && byText;
    });

    // Enrich first batch (journal/URL) for visible items only
    const first = filtered.slice(0, 12);
    await Promise.all(first.map(enrichJournal));

    render(filtered, !reset && page>0);
  }

  // ======== Events ========
  qEl.addEventListener('input', ()=>applyFilters(true));
  yearEl.addEventListener('change', ()=>applyFilters(true));
  authorEl.addEventListener('change', ()=>applyFilters(true));
  catEl.addEventListener('change', ()=>applyFilters(true));
  $('#clear').addEventListener('click', ()=>{
    qEl.value=''; yearEl.value=''; authorEl.value=''; catEl.value='';
    applyFilters(true);
  });
  loadMoreBtn.addEventListener('click', ()=> render(filtered, true));

  // ======== Go ========
  try{ await loadAll(); }
  catch(e){
    console.error(e);
    resultsEl.innerHTML = `<p>Failed to load publications. Check manifest/profiles and network.</p>`;
  }
})();
