/* Tiers, pools and periods (PRD-meetings AC-12.1, AC-09.3). Pure, shared
   with the tests. A period is the key under which usage is counted: a UTC
   day for testers, the current billing month for subscribers (from the
   renewal date the store reports), a calendar month when no renewal date
   is known. */

const H = 3600;
export const TIERS = {
  free:   { audioSeconds: 0,      summaries: 0,   period: 'month' },
  plus:   { audioSeconds: 8 * H,  summaries: 20,  period: 'month' },
  pro:    { audioSeconds: 16 * H, summaries: 50,  period: 'month' },
  max:    { audioSeconds: 24 * H, summaries: 100, period: 'month' },
  tester: { audioSeconds: 60 * 60, summaries: 10, period: 'day' },
};

export const isTier = (t) => Object.hasOwn(TIERS, t);

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Same day-of-month n months away, clamped to the month's length (UTC). */
function addMonths(ms, n) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.getTime();
}

/** [periodStart, periodEnd) in ms for a tier at `now`. */
export function period(tier, renewsAt, now = Date.now()) {
  if (TIERS[tier]?.period === 'day') {
    const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    return { start, end: start + 86400000 };
  }
  if (renewsAt && renewsAt > now) {
    let start = addMonths(renewsAt, -1);
    if (start > now) start = addMonths(start, -1);     // a renewal more than a month away: step back once more
    return { start, end: renewsAt };
  }
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return { start, end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

/** The KV key suffix for the current period. */
export const periodKey = (tier, renewsAt, now = Date.now()) => isoDay(period(tier, renewsAt, now).start);

/** What the app shows and checks against (architecture §20 `allowance`). */
export function allowance(tier, used = { audioSeconds: 0, summaries: 0 }, renewsAt = null, now = Date.now()) {
  const t = TIERS[tier] || TIERS.free;
  const { end } = period(tier, renewsAt, now);
  return {
    tier,
    renewsAt: tier === 'free' ? null : end,
    audioSecondsLeft: Math.max(0, t.audioSeconds - (used.audioSeconds || 0)),
    audioSecondsTotal: t.audioSeconds,
    summariesLeft: Math.max(0, t.summaries - (used.summaries || 0)),
    summariesTotal: t.summaries,
  };
}
