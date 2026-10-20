/* Plans (PRD-meetings US-12): the Plan section in Settings (current plan,
   the two allowance bars, the plan cards with Subscribe, Restore and
   Manage), the two sheets the AI buttons open when a plan is missing or a
   pool is used up (AC-12.6), and the locked-button state with its cost
   hint (AC-12.5). Prices come from the store when the plugin answers,
   else from the PRD table. */

import { S, PLAN_POOLS, PLAN_PRICES, planName, commit, rerender } from '../store.js';
import { fmtDate, fmtDuration } from '../dates.js';
import { esc } from '../util.js';
import { icon } from './icons.js';
import { toast, pinToViewport } from './primitives.js';
import { allowance, errorFor } from '../ai.js';
import { available, offerings, buy, restore, manageUrl, PAID_TIERS } from '../purchases.js';

export const TERMS_URL = 'https://eugeniocalva.github.io/Stackd-Minimalist/terms.html';
export const PRIVACY_URL = 'https://eugeniocalva.github.io/Stackd-Minimalist/privacy.html';

const BLURB = {
  plus: 'A 30-minute call most working days',
  pro: 'Two 30-minute calls every working day',
  max: 'About an hour of meetings every working day',
};
const poolLine = (tier) => `${PLAN_POOLS[tier].hours} h of audio · ${PLAN_POOLS[tier].summaries} summaries a month`;

/* ── Locked buttons and hints (AC-12.5) ──────────────────────────────── */

/** For an AI button: locked (Free) with the price, or a "left" hint. */
export function aiButtonState(step) {
  const p = S.plan;
  if (p.tier === 'free' && p.checkedAt) return { locked: true, hint: `from ${PLAN_PRICES.plus} / month` };
  if (!p.checkedAt) return { locked: false, hint: '' };
  if (step === 'summarise') return { locked: false, hint: `1 of ${p.summariesLeft} summar${p.summariesLeft === 1 ? 'y' : 'ies'} left` };
  return { locked: false, hint: `${fmtDuration(p.audioSecondsLeft * 1000)} of audio left` };
}

/* ── Plan cards ──────────────────────────────────────────────────────── */

let prices = {};   // tier → store price string, once offerings answered

function cardHTML(tier, current) {
  const price = prices[tier] || PLAN_PRICES[tier];
  const isCurrent = current === tier;
  const action = !available() ? ''
    : isCurrent ? '<span class="tag tag-done">Current plan</span>'
    : `<button type="button" class="btn ${current === 'free' || current === 'tester' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-buy="${tier}">${current === 'free' || current === 'tester' ? 'Subscribe' : PAID_TIERS.indexOf(tier) > PAID_TIERS.indexOf(current) ? 'Upgrade' : 'Switch'}</button>`;
  return `
  <div class="plan-card ${isCurrent ? 'is-current' : ''}">
    <div class="plan-head">
      <span class="plan-name">${planName(tier)}</span>
      <span class="plan-price num">${esc(price)}<span class="hint"> / month</span></span>
    </div>
    <span class="plan-pool">${esc(poolLine(tier))}</span>
    <span class="hint">${esc(BLURB[tier])}</span>
    ${action}
  </div>`;
}

const bar = (label, left, total, text) => `
  <div class="plan-bar" role="group" aria-label="${esc(label)}">
    <div class="plan-bar-line"><span>${esc(label)}</span><span class="num">${esc(text)}</span></div>
    <div class="plan-track"><div class="plan-fill" style="width:${total ? Math.round(100 * Math.max(0, Math.min(1, left / total))) : 0}%"></div></div>
  </div>`;

/** Settings › Plan (AC-12.2, AC-12.8, AC-12.9). */
export function planSectionHTML() {
  const p = S.plan;
  const current = p.tier;
  const paid = PAID_TIERS.includes(current);
  const status = !p.checkedAt ? 'Not checked yet'
    : current === 'free' ? 'Free · the AI steps need a plan'
    : current === 'tester' ? 'Tester · allowance resets daily'
    : `Renews ${p.renewsAt ? fmtDate(p.renewsAt, S.dateFormat) : 'monthly'}`;
  const bars = p.checkedAt && current !== 'free' ? `
    ${bar('Audio', p.audioSecondsLeft, p.audioSecondsTotal, `${fmtDuration(p.audioSecondsLeft * 1000)} of ${fmtDuration(p.audioSecondsTotal * 1000)}`)}
    ${bar('Summaries', p.summariesLeft, p.summariesTotal, `${p.summariesLeft} of ${p.summariesTotal}`)}` : '';
  return `
  <span class="section-title list-label" id="settings-plan">Plan</span>
  <div class="card plan-current">
    <div class="plan-head">
      <span class="plan-name">${planName(current)}</span>
      <span class="hint">${esc(status)}</span>
    </div>
    ${bars}
    <div class="plan-actions">
      <button type="button" class="btn btn-sm btn-secondary" data-plan-check>${icon('undo', 16)}Refresh</button>
      ${available() ? '<button type="button" class="btn btn-sm btn-secondary" data-plan-restore>Restore purchases</button>' : ''}
      ${available() && paid ? '<button type="button" class="btn btn-sm btn-ghost" data-plan-manage>Manage subscription</button>' : ''}
    </div>
  </div>
  <div class="plan-cards">
    ${PAID_TIERS.map((t) => cardHTML(t, current)).join('')}
  </div>
  <p class="hint set-hint">${available()
    ? 'Monthly subscriptions renew automatically until cancelled in your store account. The allowance resets on the renewal date; unused minutes and summaries do not carry over.'
    : 'Subscribe in the Stack’d app on iPhone or Android; the plan then applies there. Monthly subscriptions renew until cancelled.'}
    <a href="${TERMS_URL}" target="_blank" rel="noopener">Terms</a> · <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy</a></p>`;
}

async function refresh(btn) {
  if (btn) btn.disabled = true;
  try { await allowance({ force: true }); rerender(); }
  catch (e) { if (btn) btn.disabled = false; toast(errorFor(e).message); }
}

export function bindPlanSection(root) {
  root.querySelector('[data-plan-check]')?.addEventListener('click', (e) => refresh(e.currentTarget));
  root.querySelector('[data-plan-restore]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await restore();
      await allowance({ force: true }).catch(() => {});
      toast(r.tier === 'free' ? 'No purchases to restore' : `Restored: ${planName(r.tier)}`);
      rerender();
    } catch (err) { b.disabled = false; toast(err?.message || 'Restore failed'); }
  });
  root.querySelector('[data-plan-manage]')?.addEventListener('click', async () => {
    const url = await manageUrl();
    if (url) window.open(url, '_blank'); else toast('Open your store account to manage the subscription');
  });
  root.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => purchase(b.dataset.buy, b)));
  /* store prices, once; a re-render shows them */
  if (available() && !Object.keys(prices).length) {
    offerings().then((o) => {
      const next = Object.fromEntries(Object.entries(o).map(([t, v]) => [t, v.price]).filter(([, v]) => v));
      if (Object.keys(next).length) { prices = next; rerender(); }
    });
  }
}

/** The native purchase (AC-12.3), then the proxy's view wins (AC-09.2). */
async function purchase(tier, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await buy(tier);
    if (r.cancelled) { if (btn) btn.disabled = false; return; }
    await allowance({ force: true }).catch(() => {});
    toast(`${planName(r.tier)} is active`);
    commit();
  } catch (e) {
    if (btn) btn.disabled = false;
    toast(e?.message || 'The purchase did not go through.');
  }
}

/* ── The sheets the AI buttons open (AC-12.6) ────────────────────────── */

function sheet(html) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = html;
  document.body.appendChild(ov);
  const unpin = pinToViewport(ov);
  const close = () => { unpin(); ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]')?.addEventListener('click', close);
  return { ov, close };
}

const STEP_TEXT = {
  summarise: 'Summarise turns a transcript into minutes, decisions, open questions and action cards you can send to a board.',
  transcribe: 'Transcribe turns a recording into text with speaker labels.',
};

/** A Free user pressed an AI button. */
export function openPlanRequired({ step }) {
  const { ov, close } = sheet(`
  <div class="sheet" role="dialog" aria-label="Choose a plan">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <span class="section-title">This needs a plan</span>
      <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <p class="plan-intro">${esc(STEP_TEXT[step] || '')}</p>
    <div class="plan-cards">${PAID_TIERS.map((t) => cardHTML(t, S.plan.tier)).join('')}</div>
    ${available() ? '' : '<p class="hint">Subscribe in the Stack’d app on iPhone or Android.</p>'}
    <p class="hint">Renews monthly until cancelled · <a href="${TERMS_URL}" target="_blank" rel="noopener">Terms</a> · <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy</a></p>
  </div>`);
  ov.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', async () => { await purchase(b.dataset.buy, b); if (S.plan.tier !== 'free') close(); }));
}

/** A subscriber used this period's pool. */
export function openAllowanceUsed({ step, resetsAt }) {
  const tier = S.plan.tier;
  const next = PAID_TIERS[PAID_TIERS.indexOf(tier) + 1] || null;
  const what = step === 'summarise' ? 'summaries' : 'audio minutes';
  const when = resetsAt || S.plan.renewsAt;
  const { ov, close } = sheet(`
  <div class="sheet" role="dialog" aria-label="Allowance used">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <span class="section-title">Allowance used</span>
      <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <p class="plan-intro">You've used this ${tier === 'tester' ? "day's" : "month's"} ${what}.${when ? ` Resets ${esc(fmtDate(when, S.dateFormat))}.` : ''}</p>
    ${next && available() ? `<div class="plan-cards">${cardHTML(next, tier)}</div>` : ''}
    <button type="button" class="btn btn-secondary btn-block" data-close>OK</button>
  </div>`);
  ov.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', async () => { await purchase(b.dataset.buy, b); close(); }));
}
