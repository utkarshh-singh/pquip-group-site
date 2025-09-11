(async function(){
  const $ = sel => document.querySelector(sel);
  const resultsEl = $('#pub-results');
  const qInput = $('#q');
  const memberSel = $('#member');
  const yearSel = $('#year');
  const clearBtn = $('#clear');
  const loadMoreBtn = $('#load-more');
  const loadMoreWrap = $('#load-more-wrap');

  const PER_MEMBER = 5;
  const PAGE_SIZE = 24;
  const CACHE_TTL = 24*60*60*1000;

  let allPubs = [];
  let filtered = [];
  let page = 0;

  // ---------- helpers ----------
  const deburr = s => (s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9 ]/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  const normTitle = t => deburr(t).replace(/\barxiv\s*:\s*\S+/g,'').trim();

  function keyFromPub(p){
    if(p.url && p.url.startsWith('https://doi.org/')){
      return `doi:${p.url.toLowerCase()}`;
    }
    return `title:${normTitle(p.title||'')}`;
  }

  function cacheKey(id){ return `pubs:${id}`; }
  function getCache(id){
    try{
      const raw = localStorage.getItem(cacheKey(id));
      if(!raw) return null;
      const {ts,data} = JSON.parse(raw);
      return (Date.now()-ts > CACHE_TTL) ? null : data;
    }catch{ return null; }
  }
  function setCache(id, data){
    try{ localStorage.setItem(cacheKey(id), JSON.stringify({ts:Date.now(), data})); }catch{}
  }

  async function loadManifest(){
    const r = await fetch('members/manifest.json');
    return r.ok ? r.json() : [];
  }
  async function loadProfile(id){
    const r = await fetch(`members/${id}/profile.json`);
    return r.ok ? r.json() : null;
  }

  async function fetchSemScholar(authorId){
    const fields = 'papers.title,papers.year,papers.venue,papers.url,papers.externalIds,papers.authors';
    const url = `https://api.semanticscholar.org/graph/v1/author/${authorId}?fields=${fields}`;
    const r = await fetch(url);
    if(!r.ok) return [];
    const j = await r.json();
    return j.papers||[];
  }

  async function getMemberPubs(profile){
    const cached = getCache(profile.id);
    if(cached) return cached;
    if(!profile.semanticScholarId) return [];
    const raw = await fetchSemScholar(profile.semanticScholarId);
    const pubs = raw.map(p=>({
      title: p.title||'',
      year: p.year||'',
      venue: p.venue||'',
      url: (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : p.url||'#'),
      authors: (p.authors||[]).map(a=>a.name).filter(Boolean)
    }));
    setCache(profile.id, pubs);
    return pubs;
  }

  // ---------- aggregate & dedupe ----------
  async function loadAll(){
    const ids = await loadManifest();
    const profiles = (await Promise.all(ids.map(id=>loadProfile(id)))).filter(Boolean);

    // build member filter
    memberSel.innerHTML = `<option value="">All members</option>` +
      profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

    // fetch pubs in parallel
    const pubsByMember = await Promise.all(profiles.map(p=>getMemberPubs(p)));

    const merged = new Map();
    for(const pubs of pubsByMember){
      for(const pub of pubs){
        const key = keyFromPub(pub);
        if(!merged.has(key)){
          merged.set(key, {...pub});
        } else {
          const ex = merged.get(key);
          // merge authors
          ex.authors = Array.from(new Set([...(ex.authors||[]), ...(pub.authors||[])]));
          // prefer better venue
          if((!ex.venue || /arxiv/i.test(ex.venue)) && pub.venue) ex.venue = pub.venue;
        }
      }
    }

    allPubs = Array.from(merged.values())
      .sort((a,b)=>(b.year||0)-(a.year||0));

    // year filter
    const years = [...new Set(allPubs.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a);
    yearSel.innerHTML = `<option value="">All years</option>` +
      years.map(y=>`<option value="${y}">${y}</option>`).join('');

    applyFilters(true);
  }

  // ---------- render ----------
  function render(items, append=false){
    if(!append){ resultsEl.innerHTML=''; page=0; }
    const start = page*PAGE_SIZE;
    const slice = items.slice(start, start+PAGE_SIZE);

    const html = slice.map(p=>`
      <article class="pub-card">
        <h3 class="pub-title"><a href="${p.url}" target="_blank">${p.title}</a></h3>
        ${p.authors?.length ? `<div class="authors-line">${p.authors.join(', ')}</div>` : ''}
        <div class="pub-meta">${p.venue?`<em>${p.venue}</em>`:''} ${p.year||''}</div>
      </article>
    `).join('');

    resultsEl.insertAdjacentHTML('beforeend', html);
    page++;
    loadMoreWrap.classList.toggle('hidden', items.length<=page*PAGE_SIZE);
  }

  // ---------- filters ----------
  function applyFilters(reset=false){
    const q = qInput.value.toLowerCase();
    const m = memberSel.value;
    const y = yearSel.value;

    filtered = allPubs.filter(p=>{
      const okQ = !q || p.title.toLowerCase().includes(q) ||
        (p.venue||'').toLowerCase().includes(q) ||
        (p.authors||[]).some(a=>a.toLowerCase().includes(q));
      const okY = !y || String(p.year)===y;
      const okM = !m || (p.authors||[]).some(a=>a.toLowerCase().includes(m.toLowerCase()));
      return okQ && okY && okM;
    });

    render(filtered, !reset && page>0);
  }

  // ---------- events ----------
  qInput.addEventListener('input', ()=>applyFilters(true));
  memberSel.addEventListener('change', ()=>applyFilters(true));
  yearSel.addEventListener('change', ()=>applyFilters(true));
  clearBtn.addEventListener('click', ()=>{
    qInput.value=''; memberSel.value=''; yearSel.value='';
    applyFilters(true);
  });
  loadMoreBtn.addEventListener('click', ()=>render(filtered,true));

  // ---------- go ----------
  loadAll();
})();
