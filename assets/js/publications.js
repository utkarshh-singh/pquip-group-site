(async function(){
  const $ = sel => document.querySelector(sel);
  const resultsEl = $('#pub-results');
  const yearSel = $('#year');
  const memberSel = $('#member');
  const qInput = $('#q');
  const clearBtn = $('#clear');
  const loadMoreBtn = $('#load-more');
  const loadMoreWrap = $('#load-more-wrap');

  // CONFIG
  const PER_MEMBER = 5;       // how many per member to fetch
  const PAGE_SIZE = 24;       // render N at a time
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day

  let allPubs = [];           // normalized flattened pubs
  let filtered = [];          // filtered list
  let page = 0;

  // ---------- load members ----------
  async function loadManifest(){
    const r = await fetch('members/manifest.json', {cache:'no-store'});
    if(!r.ok) throw new Error('manifest missing');
    return r.json(); // ["khabat","aaron",...]
  }
  async function loadProfile(id){
    const r = await fetch(`members/${encodeURIComponent(id)}/profile.json`, {cache:'no-store'});
    if(!r.ok) throw 0;
    return r.json();
  }

  // ---------- Semantic Scholar fetch with cache ----------
  function cacheKey(id){ return `pubs:${id}`; }
  function getCache(id){
    try{
      const raw = localStorage.getItem(cacheKey(id));
      if(!raw) return null;
      const {ts,data} = JSON.parse(raw);
      if(Date.now()-ts > CACHE_TTL) return null;
      return data;
    }catch{ return null; }
  }
  function setCache(id, data){
    try{ localStorage.setItem(cacheKey(id), JSON.stringify({ts:Date.now(), data})); }catch{}
  }
  async function fetchSemScholar(authorId, count=PER_MEMBER){
    const fields = 'papers.title,papers.year,papers.venue,papers.url,papers.externalIds';
    const url = `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}?fields=${fields}`;
    const r = await fetch(url);
    if(!r.ok) throw new Error(`S2 fail ${r.status}`);
    const j = await r.json();
    const arr = (j.papers||[]).filter(Boolean)
      .sort((a,b)=>(b.year||0)-(a.year||0))
      .slice(0, count)
      .map(p => ({
        title: p.title || '',
        year: p.year || null,
        venue: p.venue || '',
        url: (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : p.url || '#')
      }));
    return arr;
  }

  async function getMemberPubs(profile){
    // prefer cache
    const cached = getCache(profile.id);
    if(cached) return cached;
    if(!profile.semanticScholarId) return [];
    try{
      const pubs = await fetchSemScholar(profile.semanticScholarId, PER_MEMBER);
      setCache(profile.id, pubs);
      return pubs;
    }catch{
      return [];
    }
  }

  // ---------- aggregate ----------
  async function loadAll(){
    const ids = await loadManifest();
    // sequential to be nice to API; you can parallelize if needed
    const profiles = [];
    for(const id of ids){
      try{ profiles.push(await loadProfile(id)); }catch{ /* skip */ }
    }
    // populate member filter
    memberSel.innerHTML = `<option value="">All members</option>` +
      profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

    // fetch pubs per member
    const rows = [];
    for(const p of profiles){
      const pubs = await getMemberPubs(p);
      pubs.forEach(pub => rows.push({...pub, memberId: p.id, memberName: p.name}));
    }
    // sort newest first; missing years at bottom
    rows.sort((a,b)=>{
      const ay = a.year || 0, by = b.year || 0;
      if(by!==ay) return by-ay;
      return (a.title||'').localeCompare(b.title||'');
    });
    allPubs = rows;

    // years filter options
    const years = [...new Set(allPubs.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a);
    yearSel.innerHTML = `<option value="">All years</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');

    applyFilters(true);
  }

  // ---------- UI / filters ----------
  function render(items, append=false){
    if(!append) { resultsEl.innerHTML=''; page = 0; }
    const start = page * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);
    const html = slice.map(p => `
      <article class="pub-card">
        <h3 class="pub-title"><a href="${p.url||'#'}" target="_blank" rel="noopener">${p.title}</a></h3>
        <div class="pub-meta">${p.venue ? `<em>${p.venue}</em>` : ''}${p.venue && p.year ? ' • ' : ''}${p.year || ''}</div>
        <div class="badges">
          <span class="badge">Author: ${p.memberName}</span>
          ${p.url && p.url.startsWith('https://doi.org/') ? `<span class="badge"><a href="${p.url}" target="_blank" rel="noopener">DOI</a></span>` : ''}
        </div>
      </article>
    `).join('');
    resultsEl.insertAdjacentHTML('beforeend', html);
    page++;
    // show/hide Load more
    if(items.length > page * PAGE_SIZE){
      loadMoreWrap.classList.remove('hidden');
    } else {
      loadMoreWrap.classList.add('hidden');
    }
  }

  function applyFilters(reset=false){
    const q = (qInput.value||'').toLowerCase();
    const m = memberSel.value;
    const y = yearSel.value;

    filtered = allPubs.filter(p=>{
      const okM = !m || p.memberId === m;
      const okY = !y || String(p.year||'') === y;
      const okQ = !q || (p.title||'').toLowerCase().includes(q) || (p.venue||'').toLowerCase().includes(q) || (p.memberName||'').toLowerCase().includes(q);
      return okM && okY && okQ;
    });

    render(filtered, !reset && page>0);
  }

  // events
  qInput.addEventListener('input', ()=>applyFilters(true));
  memberSel.addEventListener('change', ()=>applyFilters(true));
  yearSel.addEventListener('change', ()=>applyFilters(true));
  clearBtn.addEventListener('click', ()=>{
    qInput.value=''; memberSel.value=''; yearSel.value='';
    applyFilters(true);
  });
  loadMoreBtn.addEventListener('click', ()=> render(filtered, true));

  // go
  try{
    await loadAll();
  }catch(e){
    resultsEl.innerHTML = `<p>Failed to load publications.</p>`;
    console.error(e);
  }
})();
