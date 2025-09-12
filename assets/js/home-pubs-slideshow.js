document.addEventListener('DOMContentLoaded', () => {
  const track = document.getElementById('yp-track');
  if (!track) return;

  const nowYear = new Date().getFullYear();
  const bust = () => `?_=${Date.now()}`;

  // ===== Data helpers =====
  async function jget(path){
    const r = await fetch(path + bust(), {cache:'no-store'});
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }
  async function loadManual(){
    try{
      const j = await jget('data/highlights.manual.json');
      const arr = Array.isArray(j.items) ? j.items : [];
      return arr.filter(x => (x.year || nowYear) === nowYear);
    }catch{ return []; }
  }
  async function loadAuto(){
    try{
      const j = await jget('data/highlights.auto.json');
      const arr = Array.isArray(j.items) ? j.items : [];
      return arr.filter(x => (x.year || nowYear) === nowYear);
    }catch{ return []; }
  }
  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

  // ===== Card view =====
  function cardHTML(item){
    const img = item.image || 'assets/img/pubs/paper-generic.jpg';
    const title = (item.title || '').replace(/"/g,'&quot;');
    const url = item.url || '#';
    return `
      <figure class="yp-card">
        <a href="${url}" target="_blank" rel="noopener" title="${title}">
          <img src="${img}" alt="" loading="lazy" onerror="this.src='assets/img/pubs/paper-generic.jpg'">
          <figcaption>${item.title || ''}</figcaption>
        </a>
      </figure>`;
  }

  // ===== Carousel state (slide 1 item at a time) =====
  let index = 0;            // index of the first visible card
  let perView = 4;          // how many fit in viewport
  let total = 0;            // total cards
  let gap = 12;             // MUST match CSS
  let timer;

  function computePerView(){
    const w = track.closest('.yp-viewport').clientWidth;
    perView = w < 720 ? 2 : (w < 980 ? 3 : 4);
  }

  function updateTransform(){
    const card = track.querySelector('.yp-card');
    if (!card) return;
    const w = card.getBoundingClientRect().width;
    const offset = (w + gap) * index;
    track.style.transform = `translateX(${-offset}px)`;
  }

  function clampIndex(i){
    // Stop at last fully-visible start (wrap to 0)
    const maxStart = Math.max(0, total - perView);
    if (i > maxStart) return 0;                  // wrap to start for continuous feel
    if (i < 0) return maxStart;                  // wrap to end on prev
    return i;
  }

  function next(){ index = clampIndex(index + 1); updateTransform(); }
  function prev(){ index = clampIndex(index - 1); updateTransform(); }
  function resetTimer(){ clearInterval(timer); timer = setInterval(next, 5000); }

  // Buttons
  const prevBtn = document.querySelector('.yp-prev');
  const nextBtn = document.querySelector('.yp-next');
  prevBtn.addEventListener('click', ()=>{ prev(); resetTimer(); });
  nextBtn.addEventListener('click', ()=>{ next(); resetTimer(); });

  // Pause on hover
  const carousel = document.querySelector('.year-pubs__carousel');
  carousel.addEventListener('mouseenter', ()=> clearInterval(timer));
  carousel.addEventListener('mouseleave', resetTimer);

  // Recompute on resize (keep current first index in range)
  window.addEventListener('resize', () => {
    const before = perView;
    computePerView();
    if (before !== perView){
      index = clampIndex(index);
      updateTransform();
    }
  });

  // ===== Load and render =====
  (async () => {
    const manual = await loadManual();
    let auto = await loadAuto();

    // dedupe manual vs auto by url/title
    const seen = new Set(manual.map(i => (i.url || i.title || '').toLowerCase()));
    auto = auto.filter(i => !seen.has((i.url || i.title || '').toLowerCase()));

    const fill = Math.max(0, 10 - manual.length);
    const items = manual.concat(shuffle(auto).slice(0, fill));
    if (!items.length) return;

    track.innerHTML = items.map(cardHTML).join('');
    total = items.length;

    computePerView();
    index = 0;
    updateTransform();
    resetTimer();
  })();
});
