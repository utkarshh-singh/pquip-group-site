function toggleNav(){
  const nav = document.getElementById('site-nav');
  if(nav) nav.classList.toggle('open');
}

async function loadPartials(){
  try{
    const headerRes = await fetch('partials/header.html');
    if(headerRes.ok){
      document.getElementById('site-header').innerHTML = await headerRes.text();
    }
    const footerRes = await fetch('partials/footer.html');
    if(footerRes.ok){
      document.getElementById('site-footer').innerHTML = await footerRes.text();
    }
  }catch(e){
    console.error('Failed to load partials:', e);
  }
}

// run after DOM load
document.addEventListener('DOMContentLoaded', loadPartials);
