/* Where the web app lives and where its legal pages are (PRD-accounts
   US-12, architecture §30). One place, so the app, the paywall and the
   checks agree. No imports: this module must stay loadable anywhere. */

/** The web app's address from 1.6.0 on. */
export const APP_ORIGIN = 'https://app.stackdplatform.com';
export const APP_HOST = new URL(APP_ORIGIN).host;

export const TERMS_URL = `${APP_ORIGIN}/terms.html`;
export const PRIVACY_URL = `${APP_ORIGIN}/privacy.html`;
export const DELETION_URL = `${APP_ORIGIN}/account-deletion.html`;

/* The effective dates printed on the two pages. An account stores the
   versions it accepted (AC-02.8); scripts/check-origins.mjs fails when a
   page's date and its constant drift apart. */
export const TERMS_VERSION = '2026-10-20';
export const PRIVACY_VERSION = '2026-10-20';

/** True on the address the web app moved away from (GitHub Pages). There
    the shell shows the move banner and offers no account (AC-12.2). */
export function isLegacyOrigin(host = globalThis.location?.hostname || '') {
  return /(^|\.)github\.io$/i.test(host);
}
