function toggleNav(){
  const nav = document.getElementById('site-nav');
  if (nav) nav.classList.toggle('open');
}

document.addEventListener('DOMContentLoaded', loadPartials);

async function loadPartials(){
  try {
    // 1) HEAD PARTIAL — insert directly into <head> (no placeholder needed)
    //    Keep your per-page <title> in the HTML file itself.
    const headRes = await fetch('partials/head.html');
    if (headRes.ok) {
      const headHTML = await headRes.text();
      // Insert links/meta at the end of <head>
      document.head.insertAdjacentHTML('beforeend', headHTML);
    }

    // 2) HEADER
    const headerEl = document.getElementById('site-header');
    if (headerEl) {
      const headerRes = await fetch('partials/header.html');
      if (headerRes.ok) {
        headerEl.innerHTML = await headerRes.text();
        markActiveNav();   // highlight current page after header is in the DOM
      }
    }

    // 3) FOOTER
    const footerEl = document.getElementById('site-footer');
    if (footerEl) {
      const footerRes = await fetch('partials/footer.html');
      if (footerRes.ok) {
        footerEl.innerHTML = await footerRes.text();
      }
    }
  } catch (e) {
    console.error('Failed to load partials:', e);
  }
}

/* Highlight active page in the nav */
function markActiveNav(){
  const path = window.location.pathname.split('/').pop() || 'index.html';
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  const links = nav.querySelectorAll('a[href]');
  links.forEach(a => {
    const href = a.getAttribute('href');
    // treat index.html and "" the same
    const normalized = href === '' || href === '/' ? 'index.html' : href;
    if (normalized === path) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });
}
