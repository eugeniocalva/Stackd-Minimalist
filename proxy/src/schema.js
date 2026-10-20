/* The shape the model must return for Summarise (PRD-meetings AC-07.1,
   AC-08.1, AC-08.2) and the post-validation that turns it into what the
   app stores: dates re-checked against the meeting date, priorities
   matched against the user's own names, at most twelve actions, nothing
   empty. Pure. */

export const MAX_ACTIONS = 12;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'decisions', 'openQuestions', 'actions'],
  properties: {
    summary: { type: 'string', description: 'The meeting in at most 150 words of plain prose.' },
    decisions: { type: 'array', items: { type: 'string' }, description: 'Things the participants explicitly agreed on. Empty when none.' },
    openQuestions: { type: 'array', items: { type: 'string' }, description: 'Questions raised and left unresolved. Empty when none.' },
    actions: {
      type: 'array',
      description: 'Only commitments or requests the transcript states. At most 12.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'due', 'priority', 'excerpt'],
        properties: {
          title: { type: 'string', description: 'Imperative, one line; name the person when the transcript does.' },
          due: { type: ['string', 'null'], description: 'YYYY-MM-DD, only when a date or a relative date was stated, resolved against the meeting date. Else null.' },
          priority: { type: ['string', 'null'], description: 'One of the priority names given, only when urgency was stated. Else null.' },
          excerpt: { type: 'string', description: 'The transcript sentence(s) the action comes from, verbatim.' },
        },
      },
    },
  },
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86400000;
const parseISO = (s) => (ISO.test(s) ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : NaN);

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanList = (xs, max) => (Array.isArray(xs) ? xs.map((x) => clean(x, max)).filter(Boolean) : []);

/** A due date is kept when it is an ISO date within −30 … +365 days of the meeting. */
export function validDue(due, meetingDate) {
  if (typeof due !== 'string' || !ISO.test(due)) return null;
  const d = parseISO(due), m = parseISO(meetingDate);
  if (Number.isNaN(d) || Number.isNaN(m)) return null;
  const diff = (d - m) / dayMs;
  return diff >= -30 && diff <= 365 ? due : null;
}

/** The user's priority name matching the model's, case-insensitively; null otherwise. */
export function validPriority(priority, priorities) {
  if (typeof priority !== 'string' || !priority.trim()) return null;
  const p = priority.trim().toLowerCase();
  return (priorities || []).find((name) => String(name).trim().toLowerCase() === p) || null;
}

/** raw model output → { minutes, actions }; throws on a shape that is not an object. */
export function validate(raw, { meetingDate, priorities }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
  const minutes = {
    summary: clean(raw.summary, 2000),
    decisions: cleanList(raw.decisions, 300),
    openQuestions: cleanList(raw.openQuestions, 300),
  };
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .map((a) => (a && typeof a === 'object' ? {
      title: clean(a.title, 200),
      due: validDue(a.due, meetingDate),
      priority: validPriority(a.priority, priorities),
      excerpt: clean(a.excerpt, 400),
    } : null))
    .filter((a) => a && a.title)
    .slice(0, MAX_ACTIONS);
  return { minutes, actions };
}
