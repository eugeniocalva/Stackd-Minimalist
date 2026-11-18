/* Press gestures shared by Kanban cards and board rows (PRD-improvements
   US-04, US-07, US-10; architecture §41).

   bindHold: on touch, holding HOLD_MS lifts the element so it can be
   dragged; with a mouse the drag starts on movement. Holding ARM_MS without
   moving puts it down again and shows the delete badge, a small round "X"
   that stays until it is pressed or something else is. Nothing is deleted
   by the press itself: the badge calls onDelete, which asks first.

   bindSwipeRight: a swipe to the right that follows the finger: the main
   menu slides in over a top-level page, an open card slides off its board. */

import { buzz } from '../haptics.js';
import { icon } from './icons.js';

export const HOLD_MS = 350;
export const ARM_MS = 1200;
const SLOP = 8;          // px a mouse press may wander before it is a drag (and a release still a tap)
const TOUCH_SLOP = 10;   // px a finger may wander before a hold is called off
const EDGE = 56;         // px from the scroller's edge where auto-scroll starts

/* — the delete badge: one at a time — */

let armed = null;        // { el, bar }

export function disarm() {
  if (!armed) return;
  armed.el.classList.remove('is-armed');
  armed.bar.remove();
  armed = null;
}
/* capture phase: runs before the element's own handlers can stop the event */
document.addEventListener('pointerdown', (e) => { if (armed && !armed.el.contains(e.target)) disarm(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') disarm(); });

/* buttons: [{ icon, label, onClick }]. The "X" is one of them; a board row
   adds move up / move down, the way to reorder without dragging (WCAG 2.5.7). */
function arm(el, buttons) {
  disarm();
  if (!buttons.length) return;
  const bar = document.createElement('span');
  bar.className = 'hold-bar';
  buttons.forEach((b) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hold-del';
    btn.setAttribute('aria-label', b.label);
    btn.innerHTML = icon(b.icon, 14);
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());   // not a new press on the element
    btn.addEventListener('click', (e) => { e.stopPropagation(); disarm(); b.onClick(); });
    btn.addEventListener('keydown', (e) => e.stopPropagation());
    bar.appendChild(btn);
  });
  el.classList.add('is-armed');
  el.appendChild(bar);
  armed = { el, bar };
  buzz('MEDIUM');
}

/** bindHold(el, {
      ignore,                selector: a press that starts on these does nothing here
      ghostClass,            class of the copy that follows the pointer (plus 'drag-ghost')
      canDrag(),             false: the element cannot be lifted (it can still be armed)
      scroller(), axis,      element to auto-scroll near its edge while dragging, 'x' | 'y'
      onTap(ev),             released without a hold and without moving
      onDragMove(ev), onDragEnd(), onDrop(ev),
      armButtons()           [{ icon, label, onClick }] shown after the long hold; leave out for none
    }) */
export function bindHold(el, {
  ignore = '', ghostClass = '', canDrag = () => true, scroller = () => null, axis = 'x',
  onTap = null, onDragMove = null, onDragEnd = null, onDrop = null, armButtons = null,
} = {}) {
  let lastTouch = false;
  /* a long press must not open the system menu on top of ours */
  el.addEventListener('contextmenu', (e) => { if (lastTouch) e.preventDefault(); });

  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('.hold-bar') || (ignore && e.target.closest(ignore))) return;
    const wasArmed = armed?.el === el;      // a tap on an armed element only puts the badge away
    if (wasArmed) disarm();
    const isTouch = e.pointerType === 'touch';
    lastTouch = isTouch;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const draggable = canDrag();
    const sc = scroller();
    let dragging = false, held = false, ghost = null, raf = 0, scrollV = 0;

    const startDrag = () => {
      dragging = true;
      try { el.setPointerCapture(pid); } catch { /* the pointer is already gone */ }
      el.classList.add('dragging');
      sc?.classList.add('is-dragging');
      const r = el.getBoundingClientRect();
      ghost = el.cloneNode(true);
      ghost.className = `${ghostClass} drag-ghost`;
      ghost.removeAttribute('tabindex');
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;   // a lane is as tall as the board it stretches in, not its content
      ghost.style.left = `${r.left}px`;
      ghost.style.top = `${r.top}px`;
      document.body.appendChild(ghost);
      buzz('LIGHT');
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      cancelAnimationFrame(raf); raf = 0; scrollV = 0;
      try { el.releasePointerCapture(pid); } catch { /* never captured */ }
      el.classList.remove('dragging');
      sc?.classList.remove('is-dragging');
      ghost?.remove(); ghost = null;
      onDragEnd?.();
    };
    const holdTimer = isTouch && draggable ? setTimeout(() => { held = true; startDrag(); }, HOLD_MS) : null;
    let armTimer = armButtons ? setTimeout(() => {
      armTimer = null;
      endDrag();                 // put it down: the badge is pressed with a second tap
      held = true;               // the release that follows is not a tap
      arm(el, armButtons());
    }, ARM_MS) : null;

    const autoScroll = () => {
      if (!dragging || !sc) { raf = 0; return; }
      if (scrollV) { if (axis === 'x') sc.scrollLeft += scrollV; else sc.scrollTop += scrollV; }
      raf = requestAnimationFrame(autoScroll);
    };
    const blockScroll = (ev) => { if (dragging) ev.preventDefault(); };
    const move = (ev) => {
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (dist > (isTouch ? TOUCH_SLOP : SLOP)) {
        if (armTimer) { clearTimeout(armTimer); armTimer = null; }
        if (!dragging && isTouch) clearTimeout(holdTimer);         // a scroll, not a hold
        if (!dragging && !isTouch && draggable && !held) startDrag();
      }
      if (!dragging) return;
      ghost.style.transform = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`;
      onDragMove?.(ev);
      if (sc) {
        const r = sc.getBoundingClientRect();
        const [p, lo, hi] = axis === 'x' ? [ev.clientX, r.left, r.right] : [ev.clientY, r.top, r.bottom];
        scrollV = p > hi - EDGE ? Math.ceil((p - (hi - EDGE)) / 4) : p < lo + EDGE ? -Math.ceil(((lo + EDGE) - p) / 4) : 0;
        if (scrollV && !raf) raf = requestAnimationFrame(autoScroll);
      }
    };
    const finish = () => {
      clearTimeout(holdTimer); clearTimeout(armTimer);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('touchmove', blockScroll);
    };
    /* after a drag or a long hold, the click the browser still sends is not
       a tap: a lane lifted by its name must not open the rename field */
    const swallowClick = () => {
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 400);
    };
    const up = (ev) => {
      const wasDragging = dragging;
      finish(); endDrag();
      if (wasDragging || held) swallowClick();
      if (wasDragging) onDrop?.(ev);
      else if (!held && !wasArmed && Math.hypot(ev.clientX - sx, ev.clientY - sy) < SLOP) onTap?.(ev);
    };
    /* the browser took the pointer (the page started scrolling): never a tap, never a drop */
    const cancel = () => { finish(); endDrag(); };
    el.addEventListener('touchmove', blockScroll, { passive: false });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  });
}

/** A one-finger swipe to the right that follows the finger (PRD-improvements
    AC-07.1, US-04; owner's review 2026-11-17). canStart(target, x) says
    whether a touch may start one here. Once the finger has moved sideways
    more than it has moved down, start() builds whatever the swipe reveals
    and returns { move(p), settle(open) }: move gets the progress 0…1 on
    every frame, settle is called on release, open when the swipe went far
    enough (a third of the width) or fast enough. A swipe that starts in a
    sideways scroller (a chip row, the lanes) belongs to the scroller, except
    from the left edge. While a swipe runs the page does not scroll. */
export const EDGE_PX = 24;
export function bindSwipeRight(root, { canStart, start }) {
  let s = null;
  const sideways = (target) => {
    for (let n = target; n && n !== root; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  root.addEventListener('touchstart', (e) => {
    s = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const edge = t.clientX <= EDGE_PX;
    if (!canStart(e.target, t.clientX, edge) || (!edge && sideways(e.target))) return;
    s = { x: t.clientX, y: t.clientY, live: null, last: [t.clientX, performance.now()], v: 0 };
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.live) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }   // a vertical scroll
      if (dx < -10) { s = null; return; }                                         // the other way
      if (dx < 12) return;
      s.live = start();
      if (!s.live) { s = null; return; }
      s.x = t.clientX - 1;                                                         // no jump at the start
    }
    e.preventDefault();
    const now = performance.now();
    s.v = (t.clientX - s.last[0]) / Math.max(1, now - s.last[1]);
    s.last = [t.clientX, now];
    s.live.move(Math.max(0, Math.min(1, (t.clientX - s.x) / window.innerWidth)));
  }, { passive: false });
  const end = (cancelled) => {
    if (!s) return;
    const live = s.live, p = (s.last[0] - s.x) / window.innerWidth, v = s.v;
    s = null;
    live?.settle(!cancelled && (p > 1 / 3 || (v > 0.5 && p > 0.08)));
  };
  root.addEventListener('touchend', () => end(false), { passive: true });
  root.addEventListener('touchcancel', () => end(true), { passive: true });
}

/** Slides el to translateX(to) with the swipe easing, then calls done(). */
export function slideTo(el, to, done) {
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { el.style.transform = to; done(); return; }
  el.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
  requestAnimationFrame(() => { el.style.transform = to; });
  let finished = false;
  const fin = () => { if (finished) return; finished = true; el.style.transition = ''; done(); };
  el.addEventListener('transitionend', fin, { once: true });
  setTimeout(fin, 320);                                  // no transitionend when nothing moved
}
