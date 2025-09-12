(function(){
  const listEl = document.getElementById('openings-list');
  if (!listEl) return;

  const emptyTpl = document.getElementById('openings-empty');

  function tagPills(tags=[]) {
    return tags.map(t => `<span class="pill">${t}</span>`).join('');
  }

  function bulletList(items=[]) {
    if (!items.length) return '';
    return `<ul class="bullets">${items.map(li => `<li>${li}</li>`).join('')}</ul>`;
  }

  function card(o){
    const mail = o.contact ? `mailto:${o.contact}?subject=${encodeURIComponent('Application – ' + (o.title || 'Position'))}` : '#';
    return `
      <article class="open-card">
        <header class="open-card__head">
          <h3>${o.title || 'Open Position'}</h3>
          <div class="meta">
            ${o.track ? `<span class="meta-item">${o.track}</span>` : ''}
            ${o.type ? `<span class="meta-item">${o.type}</span>` : ''}
            ${o.location ? `<span class="meta-item">${o.location}</span>` : ''}
          </div>
        </header>

        ${o.tags?.length ? `<div class="tags">${tagPills(o.tags)}</div>` : ''}

        ${o.summary ? `<p class="summary">${o.summary}</p>` : ''}

        <div class="open-card__cols">
          ${o.responsibilities?.length ? `<div><h4>Responsibilities</h4>${bulletList(o.responsibilities)}</div>` : ''}
          ${o.requirements?.length ? `<div><h4>Requirements</h4>${bulletList(o.requirements)}</div>` : ''}
        </div>

        <footer class="open-card__foot">
          <div class="dates">
            ${o.start ? `<span><strong>Start:</strong> ${o.start}</span>` : ''}
            ${o.deadline ? `<span><strong>Deadline:</strong> ${o.deadline}</span>` : ''}
          </div>
          <div class="actions">
            ${o.how_to_apply ? `<span class="how">${o.how_to_apply}</span>` : ''}
            ${o.contact ? `<a class="btn" href="${mail}">Apply via Email</a>` : ''}
          </div>
        </footer>
      </article>`;
  }

  async function load(){
    try{
      const r = await fetch('data/openings.json?_=' + Date.now(), {cache:'no-store'});
      if(!r.ok) throw new Error('openings.json not found');
      const j = await r.json();
      const arr = Array.isArray(j.openings) ? j.openings : [];
      if (!arr.length) {
        listEl.innerHTML = emptyTpl?.innerHTML || '';
        return;
      }
      // Optional: sort by track then title
      arr.sort((a,b)=> (a.track||'').localeCompare(b.track||'') || (a.title||'').localeCompare(b.title||''));
      listEl.innerHTML = arr.map(card).join('');
    } catch(e){
      // graceful fallback
      listEl.innerHTML = emptyTpl?.innerHTML || '';
      console.warn('Openings:', e);
    }
  }

  load();
})();
