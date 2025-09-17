/* Member page builder — clean layout + CV/Resume button
   Looks for a PDF inside members/<id>/ (cv.pdf, resume.pdf, <id>-cv.pdf, <id>-resume.pdf)
*/

const ICONS = {
  linkedin: () => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 11-.02 5.001 2.5 2.5 0 01.02-5zM3 8.98h3.96V21H3zM9.5 8.98H13v1.64h.05c.49-.93 1.69-1.9 3.48-1.9 3.72 0 4.41 2.45 4.41 5.64V21H17V14.8c0-1.47-.03-3.36-2.05-3.36-2.05 0-2.37 1.6-2.37 3.25V21H9.5z"/></svg>`,
  scholar:  () => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 3 7l9 5 9-5-9-5zm0 7.5L6 6.17v3.66L12 13l6-3.17V6.17L12 9.5zM6 12.5V18l6 3 6-3v-5.5l-6 3-6-3z"/></svg>`,
  github:   () => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5A11.5 11.5 0 000 12a11.5 11.5 0 008 11c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.5-1.3-1.7-1.7-1.7-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.3 1.8 1.3 1 .1.8-.8 1.9-1.3-2.7-.3-5.5-1.4-5.5-6A4.7 4.7 0 014 7.1c-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.3 1.3A11.2 11.2 0 0112 4.7c1.1 0 2.2.2 3.2.5 2.3-1.6 3.3-1.3 3.3-1.3.6 1.7.2 3 .1 3.3.8.9 1.2 2 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .9.7 1.9 2.2 1.9 4.4V22c0 .3.2.7.8.6A11.5 11.5 0 0024 12 11.5 11.5 0 0012 .5z"/></svg>`,
  orcid:    () => `<svg viewBox="0 0 256 256"><circle cx="128" cy="128" r="120" fill="#A6CE39"/><path fill="#fff" d="M86 88h20v80H86zM96 64a12 12 0 110 24 12 12 0 010-24zm42 24c35 0 54 24 54 60 0 38-21 60-56 60h-26V88h28zm-8 104h6c24 0 36-16 36-44s-12-44-36-44h-6v88z"/></svg>`,
  globe:    () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"></path></svg>`
};

const bust = () => `?_=${Date.now()}`;
const qs = n => new URL(location.href).searchParams.get(n);

function parseMemberSections(html){
  const d=new DOMParser().parseFromString(html,'text/html');
  return {
    about: d.querySelector('#about')?.innerHTML || '',
    interests: [...d.querySelectorAll('#ri-list li')].map(li=>li.innerHTML),
    patents: [...d.querySelectorAll('#patents-list li')].map(li=>li.innerHTML)
  };
}
function iconBtn(href, svg, label){
  return href ? `<a class="icon-btn" href="${href}" target="_blank" rel="noopener" aria-label="${label}" title="${label}">${svg}</a>` : '';
}

async function exists(url){
  try{
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  }catch{ return false; }
}

async function findCV(memberId){
  const tries = [
    `members/${memberId}/cv.pdf`,
    `members/${memberId}/resume.pdf`,
    `members/${memberId}/${memberId}-cv.pdf`,
    `members/${memberId}/${memberId}-resume.pdf`
  ];
  for(const t of tries){
    if(await exists(`${t}${bust()}`)) return t;
  }
  return null;
}

/* read local publications.json (object or array) */
async function loadLocalPubs(memberId){
  try{
    const r = await fetch(`members/${encodeURIComponent(memberId)}/publications.json${bust()}`, {cache:'no-store'});
    if(!r.ok) return [];
    const j = await r.json();
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.publications)) return j.publications;
    return [];
  }catch{ return []; }
}

async function loadMember(){
  const id = qs('id');
  const root = document.getElementById('member-article');
  if(!id){ root.innerHTML = '<div class="profile__body"><p>No member specified.</p></div>'; return; }

  // profile.json (name can be string or array)
  let p = {};
  try{
    const r = await fetch(`members/${encodeURIComponent(id)}/profile.json${bust()}`, {cache:'no-store'});
    if(r.ok) p = await r.json();
  }catch{}

  let displayName = '';
  if (Array.isArray(p.name) && p.name.length){
    displayName = String(p.name[0]);
  } else {
    displayName = String(p.name || id);
  }
  const name   = displayName;
  const role   = p.role || '';
  const email  = p.email || '';
  const phone  = p.phone || '';
  const photo  = p.photo || 'assets/img/person-placeholder.svg';
  const orcid  = p.orcid ? `https://orcid.org/${p.orcid}` : '';
  const scholar= p.scholar || '';
  const linkedin = p.linkedin || '';
  const github = p.github || '';
  const website = p.website || '';

  // sections from members/<id>/page.html
  let parsed={about:'', interests:[], patents:[]};
  try{
    const r = await fetch(`members/${encodeURIComponent(id)}/page.html${bust()}`, {cache:'no-store'});
    if(r.ok) parsed = parseMemberSections(await r.text());
  }catch{}

  // publications (top 6)
  const pubs = (await loadLocalPubs(id))
    .filter(x => x && x.title)
    .sort((a,b)=> (b.year||0)-(a.year||0))
    .slice(0, 6);

  const pubsHTML = `
    <section class="card section">
      <h3 class="section__title">Recent Publications</h3>
      ${
        pubs.length
        ? `<ul class="pubs">` + pubs.map(p=>{
            const year  = p.year ? ` (${p.year})` : '';
            const venue = p.venue ? ` — <em>${p.venue}</em>` : '';
            const href  = p.doi ? `https://doi.org/${p.doi}` : (p.url || '#');
            return `<li><div class="pub-title"><a href="${href}" target="_blank" rel="noopener">${p.title}</a>${year}${venue}</div></li>`;
          }).join('') + `</ul>`
        : `<p class="muted">No publications found.</p>`
      }
    </section>`;

  // interests cards
  const interestGrid = parsed.interests.length ? `
    <section class="card section">
      <h3 class="section__title">Research Interests</h3>
      <div class="ri-grid">
        ${parsed.interests.map(item=>{
          const [t,...rest]=item.split('—');
          const desc = rest.join('—').trim();
          return `<div class="ri-card"><h4>${t.trim()}</h4>${desc?`<p>${desc}</p>`:''}</div>`;
        }).join('')}
      </div>
    </section>` : '';

  // patents
  const patentsHTML = parsed.patents.length ? `
    <section class="card section">
      <h3 class="section__title">Patents</h3>
      <ul class="patents">${parsed.patents.map(x=>`<li>${x}</li>`).join('')}</ul>
    </section>` : '';

  // social icons
  const iconsHTML = [
    iconBtn(linkedin, ICONS.linkedin(), 'LinkedIn'),
    iconBtn(scholar,  ICONS.scholar(),  'Google Scholar'),
    iconBtn(github,   ICONS.github(),   'GitHub'),
    iconBtn(orcid,    ICONS.orcid(),    'ORCID'),
    iconBtn(website,  ICONS.globe(),    'Website')
  ].join('');

  // CV detection (async)
  const cvPath = await findCV(encodeURIComponent(id));
  const cvBtn = cvPath
    ? `<a class="btn btn-ghost" href="${cvPath}" target="_blank" rel="noopener">Download CV</a>`
    : '';

  // render
  root.innerHTML = `
    <header class="profile-hero">
      <div class="hero-inner">
        <img class="avatar" src="${photo}" alt="${name}" />
        <div class="meta">
          <h1 class="title">${name}</h1>
          <p class="subtitle">${role}</p>
          <div class="contact">
            ${email?`<a class="contact-link" href="mailto:${email}">${email}</a>`:''}
            ${phone?`<span class="dot">•</span><a class="contact-link" href="tel:${phone.replace(/[^+0-9]/g,'')}">${phone}</a>`:''}
          </div>
          <div class="actions">
            ${cvBtn}
            <div class="icon-bar">${iconsHTML}</div>
          </div>
        </div>
      </div>
    </header>

    <div class="profile-sections">
      ${parsed.about ? `<section class="card section about">${parsed.about}</section>` : ''}
      ${interestGrid}
      ${pubsHTML}
      ${patentsHTML}
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', loadMember);
