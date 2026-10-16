/* Shared helpers: ids, HTML escaping, the app root element. */

export const uid = () => Math.random().toString(36).slice(2, 10);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const app = document.getElementById('app');
