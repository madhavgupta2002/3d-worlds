import './style.css';
import { WORLDS, byId, type World } from './registry';

const app = document.getElementById('app') as HTMLElement;
const base = import.meta.env.BASE_URL;

app.innerHTML = `
  <aside id="rail" aria-label="Worlds">
    <button id="home" class="brand" title="All worlds"><span>3D</span> World</button>
    <nav id="nav"></nav>
    <footer>
      <button id="collapse" title="Hide menu (M)">Hide menu</button>
    </footer>
  </aside>
  <main id="stage">
    <section id="gallery"></section>
    <div id="frame-wrap" hidden>
      <iframe id="frame" title="World" allow="fullscreen; pointer-lock; geolocation; clipboard-write"></iframe>
      <div id="loading" role="status">Loading…</div>
      <div id="toast"></div>
      <div id="bar">
        <button id="show-menu" title="Show menu (M)">Menu</button>
        <button id="fs" title="Fullscreen (F)">Fullscreen</button>
        <button id="reload" title="Restart this world">Restart</button>
      </div>
    </div>
  </main>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nav = $('nav'), gallery = $('gallery'), wrap = $('frame-wrap');
const frame = $<HTMLIFrameElement>('frame'), loading = $('loading'), toast = $('toast');

const groups = new Map<string, World[]>();
for (const w of WORLDS) groups.set(w.category, [...(groups.get(w.category) ?? []), w]);

nav.innerHTML = [...groups].map(([cat, ws]) => `
  <h3>${cat}</h3>
  ${ws.map((w) => `<a href="#/${w.id}" data-id="${w.id}" style="--accent:${w.accent}">${w.name}</a>`).join('')}`).join('');

gallery.innerHTML = `
  <header><h1>3D World</h1><p>${WORLDS.length} explorable worlds, one place.</p></header>
  <div class="grid">${WORLDS.map((w) => `
    <a class="card" href="#/${w.id}" style="--accent:${w.accent}">
      <span class="tag">${w.category}</span>
      <h2>${w.name}</h2>
      <p>${w.blurb}</p>
      <small>${w.hint}</small>
    </a>`).join('')}</div>`;

let toastTimer = 0;
function flash(msg: string) {
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('on'), 3500);
}

let current = '';
function route() {
  const id = location.hash.replace(/^#\/?/, '');
  const world = byId(id);
  document.title = world ? `${world.name} · 3D World` : '3D World';
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === id));
  if (!world) {
    current = '';
    frame.src = 'about:blank';
    wrap.hidden = true;
    gallery.hidden = false;
    return;
  }
  gallery.hidden = true;
  wrap.hidden = false;
  if (current !== world.id) {
    current = world.id;
    loading.classList.remove('off');
    frame.src = `${base}worlds/${world.id}/index.html`;
    flash(world.hint);
  }
}

frame.addEventListener('load', () => {
  if (frame.src !== 'about:blank') loading.classList.add('off');
});
window.addEventListener('hashchange', route);
$('home').onclick = () => { location.hash = ''; };
$('collapse').onclick = () => document.body.classList.add('rail-hidden');
$('show-menu').onclick = () => document.body.classList.remove('rail-hidden');
$('fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : wrap.requestFullscreen());
$('reload').onclick = () => { loading.classList.remove('off'); frame.src = frame.src; };
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === 'm' || e.key === 'M') document.body.classList.toggle('rail-hidden');
});

route();
