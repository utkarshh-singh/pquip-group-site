document.addEventListener('DOMContentLoaded', () => {
  const slides = document.querySelectorAll('.slide');
  const dotsContainer = document.querySelector('.slideshow-dots');
  let idx = 0, timer;

  // build dots
  slides.forEach((_, i) => {
    const btn = document.createElement('button');
    if (i === 0) btn.classList.add('active');
    btn.addEventListener('click', () => showSlide(i));
    dotsContainer.appendChild(btn);
  });
  const dots = dotsContainer.querySelectorAll('button');

  function showSlide(i){
    slides[idx].classList.remove('active');
    dots[idx].classList.remove('active');
    idx = (i+slides.length) % slides.length;
    slides[idx].classList.add('active');
    dots[idx].classList.add('active');
    resetTimer();
  }

  function next(){ showSlide(idx+1); }

  function resetTimer(){
    clearInterval(timer);
    timer = setInterval(next, 5000); // 5s interval
  }

  resetTimer();
});
