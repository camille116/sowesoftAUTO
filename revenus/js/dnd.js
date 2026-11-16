// Réorganisation par glisser-déposer : souris, doigt et clavier.
//
// Contrat HTML : un conteneur [data-group="nom"] dont les enfants directs portent [data-item="id"].
// Chaque élément contient un bouton poignée [data-drag]. À la souris, on peut aussi saisir une zone
// [data-drag-area] (l'en-tête), hors de ses liens et boutons.
//
// Pendant le déplacement, l'élément reste dans la grille, estompé : il montre où il tombera.
// Une copie suit le pointeur. Au clavier, les flèches déplacent l'élément d'un cran.

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(.2, .7, .2, 1)';
let drag = null;

export const isDragging = () => Boolean(drag?.started);

const itemsOf = (group) => [...group.children].filter((el) => el.hasAttribute('data-item'));
const order = (group) => itemsOf(group).map((el) => el.dataset.item);
const inside = (el, x, y) => {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

/** Applique un changement d'ordre en faisant glisser les éléments vers leur nouvelle place. */
function flip(group, mutate) {
  const before = new Map(itemsOf(group).map((el) => [el, el.getBoundingClientRect()]));
  mutate();
  if (reduced.matches) return;
  for (const el of itemsOf(group)) {
    const a = before.get(el);
    const b = el.getBoundingClientRect();
    if (!a || (a.left === b.left && a.top === b.top)) continue;
    el.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 180, easing: EASE });
  }
}

/**
 * Active le glisser-déposer sous `root`.
 * onReorder(groupe, ids, { id, position, total }) : appelé quand l'ordre a changé.
 * onEnd() : appelé à la fin de chaque déplacement au pointeur, changé ou non.
 */
export function sortable(root, { onReorder, onEnd = () => {} }) {
  const report = (group, item) => {
    const ids = order(group);
    onReorder(group.dataset.group, ids, { id: item.dataset.item, position: ids.indexOf(item.dataset.item) + 1, total: ids.length });
  };

  function begin() {
    const { item } = drag;
    const r = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    // La copie n'est qu'une image : ni identifiants en double, ni focus, ni lecture par les lecteurs d'écran.
    ghost.removeAttribute('data-item');
    for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '30', pointerEvents: 'none' });
    document.body.append(ghost);
    item.classList.add('drag-slot');
    document.documentElement.classList.add('dragging');
    Object.assign(drag, { ghost, started: true, left: r.left, top: r.top });
    drag.raf = requestAnimationFrame(tick);
  }

  function tick() {
    if (!drag?.started) return;
    const { ghost, item, group } = drag;
    ghost.style.transform = `translate(${drag.x - drag.x0}px, ${drag.y - drag.y0}px)${reduced.matches ? '' : ' rotate(.5deg) scale(1.02)'}`;

    // Près du haut ou du bas de l'écran, la page défile pour atteindre les éléments hors champ.
    const edge = 72;
    if (drag.y < edge) window.scrollBy(0, -Math.ceil((edge - drag.y) / 5));
    else if (drag.y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((drag.y - (window.innerHeight - edge)) / 5));

    const over = itemsOf(group).find((el) => el !== item && inside(el, drag.x, drag.y));
    if (!over) {
      drag.skip = null;
    } else if (over !== drag.skip) {
      const list = itemsOf(group);
      const after = list.indexOf(item) < list.indexOf(over);
      flip(group, () => (after ? over.after(item) : over.before(item)));
      // Pas d'aller-retour avec ce même élément tant que le pointeur ne l'a pas quitté (les cases n'ont pas toutes la même taille).
      drag.skip = over;
    }
    drag.raf = requestAnimationFrame(tick);
  }

  function end(commit) {
    const d = drag;
    if (!d) return;
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(d.raf);
    if (!d.started) return;

    if (!commit) {
      // Annulation : retour à l'ordre de départ.
      flip(d.group, () => { for (const id of d.before) d.group.append(itemsOf(d.group).find((el) => el.dataset.item === id)); });
    }
    const changed = commit && order(d.group).join('|') !== d.before.join('|');
    const settle = () => {
      d.ghost.remove();
      d.item.classList.remove('drag-slot');
      document.documentElement.classList.remove('dragging');
      if (changed && d.item.isConnected) report(d.group, d.item);
      onEnd();
    };
    if (reduced.matches) { settle(); return; }
    // La copie rejoint la case d'arrivée avant de disparaître.
    const slot = d.item.getBoundingClientRect();
    const anim = d.ghost.animate(
      [{ transform: d.ghost.style.transform }, { transform: `translate(${slot.left - d.left}px, ${slot.top - d.top}px)` }],
      { duration: 170, easing: EASE, fill: 'forwards' },
    );
    anim.onfinish = settle;
    anim.oncancel = settle;
  }

  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    if (!drag.started && Math.hypot(drag.x - drag.x0, drag.y - drag.y0) >= drag.threshold) begin();
    if (drag.started) ev.preventDefault();
  }
  function onUp(ev) { if (drag && ev.pointerId === drag.pointerId) end(true); }
  function onCancel(ev) { if (drag && ev.pointerId === drag.pointerId) end(false); }
  function onKey(ev) {
    if (ev.key !== 'Escape' || !drag?.started) return;
    ev.preventDefault();
    ev.stopPropagation();
    end(false);
  }

  root.addEventListener('pointerdown', (ev) => {
    if (drag || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const handle = ev.target.closest('[data-drag]');
    const control = ev.target.closest('a, button, input, select, textarea, summary, label');
    const area = handle || (ev.pointerType === 'mouse' && !control ? ev.target.closest('[data-drag-area]') : null);
    const item = area?.closest('[data-item]');
    const group = item?.parentElement;
    if (!group?.hasAttribute('data-group')) return;
    ev.preventDefault(); // pas de sélection de texte en tirant
    drag = {
      item, group, pointerId: ev.pointerId,
      x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY,
      threshold: ev.pointerType === 'mouse' ? 5 : 3,
      before: order(group), started: false, skip: null, ghost: null, raf: 0,
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  });

  // Clavier : sur la poignée, les flèches déplacent l'élément d'un cran ; Début et Fin l'envoient au bout.
  root.addEventListener('keydown', (ev) => {
    const handle = ev.target.closest?.('[data-drag]');
    if (!handle || drag) return;
    const item = handle.closest('[data-item]');
    const group = item?.parentElement;
    if (!group?.hasAttribute('data-group')) return;
    const list = itemsOf(group);
    const i = list.indexOf(item);
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[ev.key];
    const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? list.length - 1 : step ? Math.min(list.length - 1, Math.max(0, i + step)) : null;
    if (j == null) return;
    ev.preventDefault();
    if (j === i) return;
    flip(group, () => (j > i ? list[j].after(item) : list[j].before(item)));
    handle.focus({ preventScroll: true }); // un élément déplacé dans la page perd le focus : on le lui rend
    item.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' });
    report(group, item);
  });
}
