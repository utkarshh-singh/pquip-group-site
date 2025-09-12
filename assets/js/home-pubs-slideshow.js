document.addEventListener('DOMContentLoaded', () => {
  const track = document.getElementById('yp-track');
  const dotsWrap = document.getElementById('yp-dots');
  if (!track || !dotsWrap) return;

  const nowYear = new Date().getFullYear();
  const bust = () => `?_=${Date.now()}`;

  // ---- fetch helpers ----
  async function jget(path){
    const r = await fetch(path + bust(), {cache:'no-store'});
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }

  function shuffle(a){
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }

  // Build one card
  function cardHTML(item){
    const img = item.image || 'assets/img/pubs/paper-generic.jpg';
    const title = (item.title || '').replace(/"/g,'&quot;');
    const url = item.url || '#';
    return `
      <figure class="yp-card">
        <a href="${url}" target="_blank" rel="noopener" title="${title}">
          <img src="${img}" alt="">
          <figcaption>${item.title || ''}</figcaption>
        </a>
      </figure>`;
  }

  // ---- carousel wiring ----
  let slideIndex = 0, pages = 1, perView = 4, timer;
  function computePerView(){
    const w = track.closest('.yp-viewport').clientWidth;
    perView = w < 720 ? 2 : (w < 980 ? 3 : 4);
  }
  function updateTransform(){
    const card = track.querySelector('.yp-card');
    if (!card) return;
    const gap = 10;
    const cardWidth = card.getBoundingClientRect().width;
    const offset = (cardWidth + gap) * perView * slideIndex;
    track.style.transform = `translateX(${-offset}px)`;
    dotsWrap.querySelectorAll('button').forEach((d,i)=>d.classList.toggle('active', i===slideIndex));
  }
  function go(i, user=false){ slideIndex = (i + pages) % pages; updateTransform(); if(user) resetTimer(); }
  function next(){ go(slideIndex + 1); }
  function resetTimer(){ clearInterval(timer); timer = setInterval(next, 5000); }

  // ---- load data from the two JSONs ----
  async function loadManual(){
    try{
      const j = await jget('data/highlights.manual.json');
      const items = Array.isArray(j.items) ? j.items : [];
      // Keep only current year unless you want cross-year items; change if needed
      return items.filter(x => (x.year || nowYear) === nowYear);
    }catch{ return []; }
  }
  async function loadAuto(){
    try{
      const j = await jget('data/highlights.auto.json');
      const items = Array.isArray(j.items) ? j.items : [];
      // fallback: filter to current year (defensive)
      return items.filter(x => (x.year || nowYear) === nowYear);
    }catch{ return []; }
  }

  function render(all){
    computePerView();
    track.innerHTML = all.map(cardHTML).join('');
    const total = all.length;
    pages = Math.max(1, Math.ceil(total / perView));

    // dots
    dotsWrap.innerHTML = '';
    for(let i=0;i<pages;i++){
      const b = document.createElement('button');
      if(i===0) b.classList.add('active');
      b.addEventListener('click', ()=>go(i, true));
      dotsWrap.appendChild(b);
    }

    slideIndex = 0;
    updateTransform();
    resetTimer();
  }

  // controls + behaviors
  const prevBtn = document.querySelector('.yp-prev');
  const nextBtn = document.querySelector('.yp-next');
  const carousel = document.querySelector('.year-pubs__carousel');

  prevBtn.addEventListener('click', ()=>go(slideIndex-1, true));
  nextBtn.addEventListener('click', ()=>go(slideIndex+1, true));
  carousel.addEventListener('mouseenter', ()=>clearInterval(timer));
  carousel.addEventListener('mouseleave', resetTimer);
  window.addEventListener('resize', () => { const p=perView; computePerView(); if(p!==perView) updateTransform(); });

  (async () => {
    const manual = await loadManual();              // priority
    let auto = await loadAuto();

    // Remove duplicates (match by title/url) between manual and auto
    const seen = new Set(manual.map(i => (i.url || i.title || '').toLowerCase()));
    auto = auto.filter(i => !seen.has((i.url || i.title || '').toLowerCase()));

    // Manual first (keep order), then random auto to fill up to 10
    const fill = Math.max(0, 10 - manual.length);
    const picks = manual.concat(shuffle(auto).slice(0, fill));

    if (!picks.length){
      document.querySelector('.year-pubs__head .muted').textContent =
        `No highlights found for ${nowYear}.`;
      return;
    }
    render(picks);
  })();
});
