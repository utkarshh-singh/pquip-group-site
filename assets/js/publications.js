(async function(){
  const PER_PAGE = 24;

  const $ = s => document.querySelector(s);
  const resultsEl = $('#pub-results');
  const qEl = $('#q'), yearEl = $('#year'), authorEl = $('#author'), catEl = $('#category');
  const clearBtn = $('#clear'), loadMoreBtn = $('#load-more'), loadMoreWrap = $('#load-more-wrap');

  let allPubs = [];
  let filtered = [];
  let page = 0;

  const norm = t => (t||'').toLowerCase().replace(/\s+/g,' ').trim();

  async function loadManifest(){
    const r = await fetch('members/manifest.json', {cache:'no-store'});
    if(!r.ok) throw new Error('members/manifest.json missing');
    return r.json();
  }
  async function loadProfile(id){
    const r = await fetch(`members/${encodeURIComponent(id)}/profile.json`, {cache:'no-store'});
    if(!r.ok) throw new Error(`profile missing for ${id}`);
    return r.json();
  }
  async function loadMemberPubs(id){
    const r = await fetch(`members/${encodeURIComponent(id)}/publications.json`, {cache:'no-store'});
    if(!r.ok) return null; // allow missing file
    return r.json();
  }

  function keyFor(pub){
    if (pub.doi) return `doi:${String(pub.doi).toLowerCase()}`;
    const t = norm(pub.title);
    return t ? `t:${t}` : `u:${(pub.year||'0')}:${Math.random().toString(36).slice(2,8)}`;
  }

  async function loadAll(){
    const ids = await loadManifest();

    // Load profiles + local pubs.json in parallel
    const profs = (await Promise.all(ids.map(id => loadProfile(id).catch(()=>null)))).filter(Boolean);
    const pubsFiles = await Promise.all(
      profs.map(p => loadMemberPubs(p.id).then(j => ({id:p.id, json:j, profile:p})))
    );

    // Author list (group members only)
    authorEl.innerHTML = `<option value="">All authors (group)</option>` +
      profs.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

    // Merge publications across members
    const merged = new Map();

    for (const row of pubsFiles){
      const pjson = row.json;
      if (!pjson) continue; // skip missing
      const pubs = pjson.publications || [];
      for (const pub of pubs){
        const k = keyFor(pub);
        if (!merged.has(k)){
          merged.set(k, {
            title: pub.title || '',
            year: pub.year ?? null,
            venue: pub.venue || '',
            doi: pub.doi || null,
            url: pub.url || '',
            authors: [...(pub.authors||[])],   // all authors (strings)
            groupAuthors: [],                   // to fill
            categories: []                      // to fill
          });
        } else {
          const it = merged.get(k);
          // Upgrade venue/url/doi if better
          if ((!it.doi && pub.doi)) it.doi = pub.doi;
          if ((!it.venue || /arxiv/i.test(it.venue)) && pub.venue) it.venue = pub.venue;
          if (!it.url && pub.url) it.url = pub.url;
          it.authors = Array.from(new Set([...(it.authors||[]), ...(pub.authors||[])]));
        }
      }
    }

    // Compute group coauthors + categories (union from profiles)
    const aliasTable = profs.map(p => ({
      id: p.id,
      name: p.name,
      aliases: [p.name.toLowerCase(), ...(p.aliases||[]).map(a=>a.toLowerCase())],
      categories: (p.categories && p.categories.length ? p.categories : (p.topics||[])) || []
    }));

    for (const [k, it] of merged.entries()){
      const lowers = (it.authors||[]).map(a => a.toLowerCase());
      const groupMatches = aliasTable.filter(a => a.aliases.some(al => lowers.includes(al)));
      it.groupAuthors = groupMatches.map(m => ({id:m.id, name:m.name}));
      const cats = new Set();
      groupMatches.forEach(m => (m.categories||[]).forEach(c => cats.add(c)));
      it.categories = [...cats];
    }

    // Final array + sort newest first
    allPubs = Array.from(merged.values())
      .sort((a,b)=> (b.year||0)-(a.year||0) || (a.title||'').localeCompare(b.title||''));

    // Filters: years + categories
    const years = [...new Set(allPubs.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a);
    yearEl.innerHTML = `<option value="">All years</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');

    const allCats = [...new Set(allPubs.flatMap(p => p.categories || []))].sort((a,b)=>a.localeCompare(b));
    catEl.innerHTML = `<option value="">All categories</option>` + allCats.map(c=>`<option value="${c}">${c}</option>`).join('');

    applyFilters(true);
  }

  function render(items, append=false){
    if(!append){ resultsEl.innerHTML=''; page = 0; }
    const start = page * PER_PAGE;
    const slice = items.slice(start, start + PER_PAGE);

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
    if(items.length > page * PER_PAGE) loadMoreWrap.classList.remove('hidden');
    else loadMoreWrap.classList.add('hidden');
  }

  function applyFilters(reset=false){
    const q = norm(qEl.value);
    const y = yearEl.value;
    const m = authorEl.value;
    const c = catEl.value;

    filtered = allPubs.filter(p=>{
      const byYear = !y || String(p.year||'') === y;
      const byMember = !m || (p.groupAuthors||[]).some(a => a.id === m);
      const byCat = !c || (p.categories||[]).includes(c);
      const byText = !q || norm(p.title).includes(q) || norm(p.venue).includes(q) ||
                     (p.groupAuthors||[]).some(a => norm(a.name).includes(q));
      return byYear && byMember && byCat && byText;
    });

    render(filtered, !reset && page>0);
  }

  // events
  qEl.addEventListener('input', ()=>applyFilters(true));
  yearEl.addEventListener('change', ()=>applyFilters(true));
  authorEl.addEventListener('change', ()=>applyFilters(true));
  catEl.addEventListener('change', ()=>applyFilters(true));
  clearBtn.addEventListener('click', ()=>{
    qEl.value=''; yearEl.value=''; authorEl.value=''; catEl.value='';
    applyFilters(true);
  });
  loadMoreBtn.addEventListener('click', ()=> render(filtered, true));

  // go
  try{ await loadAll(); }
  catch(e){
    console.error(e);
    resultsEl.innerHTML = `<p>Failed to load publications. Check members/manifest.json, profile.json, and publications.json files.</p>`;
  }
})();
