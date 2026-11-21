/* The "+" menu (PRD-improvements US-09): the same grid on every page that
   shows the button, instead of a "+" that meant a task on a board, a note
   on Notes and a meeting on Meetings. Rendered outside #app, like the other
   sheets, so a re-render never removes it. */

import { overlay } from './primitives.js';
import { icon } from './icons.js';
import { openSheet } from './addsheet.js';
import { openNotes, focusComposer } from './notes.js';
import { addMeeting } from './meetings.js';
import { newBoardFlow } from './sharing.js';

const TILES = [
  { id: 'task', label: 'Add task', icon: 'tasks', run: () => openSheet() },
  { id: 'note', label: 'Add note', icon: 'note', run: () => { openNotes(); focusComposer(); } },
  { id: 'meeting', label: 'Add meeting', icon: 'meeting', run: () => addMeeting() },
  /* was "Add automation", which only led to a "coming soon" row (testing
     report BUG-07); it comes back when custom rules exist */
  { id: 'board', label: 'Add board', icon: 'board', run: () => newBoardFlow() },
];

export function openAddMenu() {
  /* no sheet around them (owner's review 2026-11-17, AC-09.1): the four
     tiles alone, over the blurred page, rising one after another */
  const { ov, close } = overlay(`
    <div class="add-menu" role="dialog" aria-label="Add">
      <div class="add-grid">
        ${TILES.map((t, i) => `
        <button class="add-tile" data-tile="${t.id}" style="--i: ${i}">
          <span class="add-tile-icon">${icon(t.icon, 20)}</span>
          <span>${t.label}</span>
        </button>`).join('')}
      </div>
    </div>`);
  ov.classList.add('add-overlay');
  /* a tap between or around the tiles closes too */
  ov.querySelector('.add-menu').addEventListener('click', (e) => { if (!e.target.closest('[data-tile]')) close(); });
  ov.querySelectorAll('[data-tile]').forEach((b) =>
    b.addEventListener('click', () => { close(); TILES.find((t) => t.id === b.dataset.tile).run(); }));
  ov.querySelector('[data-tile]').focus();
}
