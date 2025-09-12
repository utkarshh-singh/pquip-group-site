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

  // ===== Carousel state (infinite loop, 1-by-1) =====
  let index = 0;             // index within the *cloned* track
  let perView = 4;           // cards visible; recalculated on resize
  let total = 0;             // original items count (no clones)
  let gap = 12;              // MUST match CSS
  let timer;
  let sliding = false;       // lock during transition

  function computePerView(){
    const w = track.closest('.yp-viewport').clientWidth;
    perView = w < 720 ? 2 : (w < 980 ? 3 : 4);
  }

  function cardWidth(){
    const c = track.querySelector('.yp-card');
    return c ? c.getBoundingClientRect().width : 0;
  }

  function translateTo(i, withAnim = true){
    const width = cardWidth();
    const offset = (width + gap) * i;
    if (!withAnim) {
      track.style.transition = 'none';
      track.style.transform  = `translateX(${-offset}px)`;
      // force reflow, then restore transition
      void track.offsetHeight;
      track.style.transition = '';
    } else {
      track.style.transform  = `translateX(${-offset}px)`;
    }
  }

  function next(auto = false){
    if (sliding) return;
    sliding = true;
    index += 1;
    translateTo(index, true);
  }

  function prev(auto = false){
    if (sliding) return;
    sliding = true;
    index -= 1;
    translateTo(index, true);
  }

  function resetTimer(){
    clearInterval(timer);
    timer = setInterval(() => next(true), 5000);
  }

  // Buttons
  const prevBtn = document.querySelector('.yp-prev');
  const nextBtn = document.querySelector('.yp-next');
  prevBtn.addEventListener('click', ()=>{ prev(false); resetTimer(); });
  nextBtn.addEventListener('click', ()=>{ next(false); resetTimer(); });

  // Pause on hover
  const carousel = document.querySelector('.year-pubs__carousel');
  carousel.addEventListener('mouseenter', ()=> clearInterval(timer));
  carousel.addEventListener('mouseleave', resetTimer);

  // Snap after CSS transition ends (wrap logic with clones)
  track.addEventListener('transitionend', () => {
    const totalCloned = total + 2 * perView; // total children in track
    const firstReal   = perView;             // first real card index
    const lastRealEnd = perView + total - 1; // last real card index

    if (index > lastRealEnd) {
      // moved into the cloned head → jump back to first real
      index = firstReal;
      translateTo(index, false);
    } else if (index < firstReal) {
      // moved into the cloned tail → jump to last real
      index = lastRealEnd;
      translateTo(index, false);
    }
    sliding = false;
  });

  // Re-render with correct clones when layout changes
  window.addEventListener('resize', () => {
    const before = perView;
    computePerView();
    if (before !== perView) {
      rebuildTrack(); // rebuild clones for new perView
    } else {
      // minor width change → keep current transform accurate
      translateTo(index, false);
    }
  });

  // ===== Build track with clones =====
  function rebuildTrackContent(items){
    // items: original list
    const frag = [];
    const n = items.length;
    // 1) tail clones (last perView → start)
    const tail = items.slice(Math.max(0, n - perView));
    tail.forEach(it => frag.push(cardHTML(it)));
    // 2) original
    items.forEach(it => frag.push(cardHTML(it)));
    // 3) head clones (first perView → end)
    const head = items.slice(0, perView);
    head.forEach(it => frag.push(cardHTML(it)));
    track.innerHTML = frag.join('');
  }

  function rebuildTrack(){
    // Rebuild using the previously chosen items in DOM
    const originals = Array.from(track.querySelectorAll('.yp-card a')).map(a => ({
      url: a.getAttribute('href'),
      image: a.querySelector('img')?.getAttribute('src'),
      title: a.getAttribute('title')
    }));
    if (!originals.length) return;
    computePerView();
    rebuildTrackContent(originals);
    total = originals.length;

    // Start at first real item (after tail clones)
    index = perView;
    translateTo(index, false);
  }

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

    computePerView();
    rebuildTrackContent(items);
    total = items.length;

    // set start position to first real card (skip tail clones)
    index = perView;
    translateTo(index, false);

    resetTimer();
  })();
});
