(function(){
  function getId(){
    try{ return new URL(location.href).searchParams.get('id'); }catch{ return null; }
  }
  function svgArrow(left=false){
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
      ${left ? '<path d="M15 6l-6 6 6 6"/>' : '<path d="M9 6l6 6-6 6"/>'}
    </svg>`;
  }

  function createSlider(slides){
    const root = document.createElement('section');
    root.className = 'card card--highlight';
    root.innerHTML = `
      <div class="card__inner">
        <div class="slider" role="region" aria-label="Highlights">
          <div class="slider__track"></div>
          <div class="slider__nav">
            <button class="slider__btn" data-prev aria-label="Previous">${svgArrow(true)}</button>
            <div class="slider__dots" aria-hidden="true"></div>
            <button class="slider__btn" data-next aria-label="Next">${svgArrow(false)}</button>
          </div>
        </div>
      </div>
    `;
    const track = root.querySelector('.slider__track');
    track.innerHTML = slides.map(s => `
      <div class="slide">
        ${s.link ? `<a href="${s.link}" target="_blank" rel="noopener">` : ''}
          <img class="slide__img" src="${s.image}" alt="${s.title || ''}">
        ${s.link ? `</a>` : ''}
        <div class="slide__body">
          ${s.title ? `<h4>${s.title}</h4>` : ''}
          ${s.caption ? `<p>${s.caption}</p>` : ''}
        </div>
      </div>
    `).join('');

    // dots
    const dots = root.querySelector('.slider__dots');
    slides.forEach((_,i)=>{
      const b = document.createElement('button');
      b.className='slider__dot'; b.type='button';
      b.setAttribute('aria-label', `Go to slide ${i+1}`);
      b.addEventListener('click', ()=> goTo(i));
      dots.appendChild(b);
    });

    let index = 0, len = slides.length;
    function update(){
      track.style.transform = `translateX(-${index*100}%)`;
      [...dots.children].forEach((d,i)=> d.setAttribute('aria-current', i===index ? 'true':'false'));
    }
    function goTo(i){ index = (i+len)%len; update(); }
    root.querySelector('[data-prev]').addEventListener('click', ()=> goTo(index-1));
    root.querySelector('[data-next]').addEventListener('click', ()=> goTo(index+1));

    // swipe
    let sx=0;
    track.addEventListener('touchstart', e=> sx=e.touches[0].clientX, {passive:true});
    track.addEventListener('touchend', e=>{
      const dx=(e.changedTouches[0].clientX - sx);
      if (Math.abs(dx)>40) goTo(index + (dx<0?1:-1));
    }, {passive:true});

    // auto-advance (optional)
    let timer = setInterval(()=> goTo(index+1), 7000);
    root.addEventListener('mouseenter', ()=> clearInterval(timer));
    root.addEventListener('mouseleave', ()=> { timer = setInterval(()=> goTo(index+1), 7000); });

    // init
    update();
    return root;
  }

  async function init(){
    const id = getId(); if(!id) return;
    // fetch slides.json if present
    try{
      const res = await fetch(`members/${encodeURIComponent(id)}/slides.json`, {cache: 'no-store'});
      if(!res.ok) return; // no slides -> silently skip
      const slides = await res.json();
      if(!Array.isArray(slides) || !slides.length) return;

      // insert AFTER the About block (first .profile__body > .card)
      const body = document.querySelector('.profile__body');
      if(!body) return;
      const firstCard = body.querySelector('.card');
      const sliderCard = createSlider(slides);
      if(firstCard && firstCard.parentNode === body){
        body.insertBefore(sliderCard, firstCard.nextSibling);
      }else{
        body.prepend(sliderCard);
      }
    }catch(e){
      // fail silently if file missing or invalid
      console.warn('Slideshow skipped:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
