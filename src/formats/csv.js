/* CSV as programs really write it (PRD 1.7.0 §06.1): cells in double quotes
   may hold the separator, line breaks and "" for a quote; lines end in LF,
   CRLF or CR; a file may start with a byte-order mark; the separator is a
   comma, a semicolon (spreadsheets in much of Europe) or a tab. Pure: no
   DOM, no store, so scripts/check-import.mjs runs it under Node. */

function parse(s, sep, maxRows = Infinity) {
  const rows = [];
  let row = [], cell = '', quoted = false, i = 0;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); if (row.some((c) => c !== '')) rows.push(row); row = []; };
  while (i < s.length && rows.length < maxRows) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"' && cell.trim() === '') { cell = ''; quoted = true; i++; continue; }   // also after a space: 1, "x, y"
    if (c === sep) { endCell(); i++; continue; }
    if (c === '\r') { endRow(); i += s[i + 1] === '\n' ? 2 : 1; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    cell += c; i++;
  }
  if (rows.length < maxRows && (cell !== '' || row.length)) endRow();
  return rows;
}

/** The separator: the one that splits the first records into the same
    number of columns, and the most of them. A comma when nothing tells. */
function sniff(s) {
  const head = s.slice(0, 20000);
  let best = ',', top = 0;
  for (const sep of [',', ';', '\t']) {
    const rows = parse(head, sep, 6);
    if (!rows.length) continue;
    const n = rows[0].length;
    const steady = rows.filter((r) => r.length === n).length;
    const score = n > 1 ? n * 10 + steady : 0;
    if (score > top) { top = score; best = sep; }
  }
  return best;
}

/** text → rows of cells, every cell a string. Rows that are wholly empty
    are dropped. A first line "sep=;", which spreadsheets write, names the
    separator. */
export function parseCSV(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const named = /^sep=(.)\r?\n/.exec(s);
  if (named) s = s.slice(named[0].length);
  return parse(s, named ? named[1] : sniff(s));
}
