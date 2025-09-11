function toggleNav(){
  const nav = document.getElementById('site-nav');
  if(nav) nav.classList.toggle('open');
}
// run after DOM load
document.addEventListener('DOMContentLoaded', loadPartials);

async function loadPartials(){
  try {
    // head
    const headRes = await fetch('partials/head.html');
    if (headRes.ok) {
      document.getElementById('site-head').outerHTML = await headRes.text();
    }

    // header
    const headerRes = await fetch('partials/header.html');
    if (headerRes.ok) {
      document.getElementById('site-header').innerHTML = await headerRes.text();
    }

    // footer
    const footerRes = await fetch('partials/footer.html');
    if (footerRes.ok) {
      document.getElementById('site-footer').innerHTML = await footerRes.text();
    }
  } catch(e) {
    console.error('Failed to load partials:', e);
  }
}
