/* Search matching (PRD-notes US-08): case- and accent-insensitive, every
   word of the query must appear somewhere in the item's fields. Pure module
   (no DOM, no store) so scripts/check-text.mjs runs it under Node; the field
   itself lives in src/ui/search.js. */

import { toText } from './richtext.js';

/** Lower-case with accents stripped: 'Café' → 'cafe'. */
export const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every whitespace-separated term of the query appears in some field. An
    empty query matches everything. */
export function matches(query, fields) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = fields.map(normalize).join('\n');
  return terms.every((t) => hay.includes(t));
}

/** Title, tags and subtask titles. */
export function filterTasks(tasks, query) {
  if (!normalize(query).trim()) return tasks;
  return tasks.filter((t) => matches(query, [t.title, ...t.tags, ...t.subtasks.map((s) => s.title)]));
}

/** Meetings (PRD-meetings AC-02.4): title, transcript text and speaker
    names, minutes and action titles. titleOf supplies the dated default
    title the store shows for an untitled meeting. */
export function filterMeetings(meetings, query, titleOf = (m) => m.title) {
  if (!normalize(query).trim()) return meetings;
  return meetings.filter((m) => matches(query, [
    titleOf(m),
    ...(m.transcript?.segments || []).map((s) => s.text),
    ...Object.values(m.transcript?.speakers || {}).filter(Boolean),
    m.minutes?.summary || '', ...(m.minutes?.decisions || []), ...(m.minutes?.openQuestions || []),
    ...(m.actions || []).map((a) => a.title),
  ]));
}

/** Title, body text, checklist items and tags; `tag` narrows first (AND). */
export function filterNotes(notes, query, tag = null) {
  let ns = notes;
  if (tag) {
    const key = tag.toLowerCase();
    ns = ns.filter((n) => n.tags.some((x) => x.toLowerCase() === key));
  }
  if (!normalize(query).trim()) return ns;
  return ns.filter((n) => matches(query, [n.title, toText(n.body), ...(n.checklist || []).map((c) => c.text), ...n.tags]));
}
