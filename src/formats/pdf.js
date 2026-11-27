/* A PDF written by hand (PRD 1.7.0 §06.2, decision 7): A4, the same
   layout as the Word file, in the four Helvetica faces every PDF reader
   has, so nothing is embedded and the file stays small. Those faces hold
   the letters of Western European languages, the euro sign and the usual
   punctuation (the Windows-1252 set); any other letter prints as "?", and
   the Type of file page says so when it happens (pdfCannotShow).

   Text is laid out here: words are measured with the faces' widths and
   wrapped to the page, a heading or a task's title is never left alone at
   the foot of a page, and each page has its number at the foot. Boxes for
   subtasks, underlines and strikes are drawn as lines. The whole file is
   ASCII (letters above 127 are written as \ooo), so its byte offsets are
   its character offsets. Pure: given the document src/exporter.js makes. */

/* Widths of the characters 32 to 126, in thousandths of the size. */
const REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
/* the characters 128 to 159 of Windows-1252, by their Unicode number */
const HIGH = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
  0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
const SHARED = { 0x80: 556, 0x83: 556, 0x85: 1000, 0x86: 556, 0x87: 556, 0x88: 333, 0x89: 1000, 0x8B: 333, 0x8C: 1000, 0x95: 350, 0x96: 556, 0x97: 1000, 0x98: 333, 0x99: 1000, 0x9B: 333, 0x9C: 944,
  0xA0: 278, 0xA2: 556, 0xA3: 556, 0xA4: 556, 0xA5: 556, 0xA7: 556, 0xA9: 737, 0xAB: 556, 0xAC: 584, 0xAD: 333, 0xAE: 737, 0xB0: 400, 0xB1: 584, 0xB2: 333, 0xB3: 333, 0xB5: 556, 0xB9: 333, 0xBB: 556,
  0xBC: 834, 0xBD: 834, 0xBE: 834, 0xC6: 1000, 0xD0: 722, 0xD7: 584, 0xD8: 778, 0xDE: 667, 0xF7: 584 };
const WIDE = {
  R: { ...SHARED, 0x82: 222, 0x84: 333, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0xA1: 333, 0xA6: 260, 0xB6: 537, 0xBF: 611, 0xDF: 611, 0xE6: 889, 0xF0: 556, 0xF8: 611, 0xFE: 556 },
  B: { ...SHARED, 0x82: 278, 0x84: 500, 0x91: 278, 0x92: 278, 0x93: 500, 0x94: 500, 0xA1: 333, 0xA6: 280, 0xB6: 556, 0xBF: 611, 0xDF: 611, 0xE6: 889, 0xF0: 611, 0xF8: 611, 0xFE: 611 },
};
const CHAR_OF = Object.fromEntries(Object.entries(HIGH).map(([cp, b]) => [b, String.fromCodePoint(+cp)]));

/** A character → its byte in Windows-1252, or -1 when there is none. */
const byteOf = (cp) => (cp >= 32 && cp <= 126) || (cp >= 0xA0 && cp <= 0xFF) ? cp : HIGH[cp] ?? -1;
/** True when a text holds a letter the PDF prints as "?". */
export const pdfCannotShow = (s) => { for (const ch of String(s ?? '').normalize('NFC')) { const cp = ch.codePointAt(0); if (cp > 31 && byteOf(cp) === -1) return true; } return false; };

/** Text → the bytes the page shows: Windows-1252, "?" for anything else. */
const bytesOf = (s) => { const out = []; for (const ch of String(s).normalize('NFC')) { const cp = ch.codePointAt(0); out.push(cp === 9 || cp === 10 ? 32 : byteOf(cp) === -1 ? 63 : byteOf(cp)); } return out; };
function widthOf(b, bold) {
  if (b >= 32 && b <= 126) return (bold ? BOLD : REGULAR)[b - 32];
  const wide = WIDE[bold ? 'B' : 'R'][b];
  if (wide) return wide;
  const base = (CHAR_OF[b] || String.fromCharCode(b)).normalize('NFD').charCodeAt(0);   // é is as wide as e, Š as S
  return base >= 32 && base <= 126 ? (bold ? BOLD : REGULAR)[base - 32] : 556;
}
const measure = (bytes, bold, size) => bytes.reduce((n, b) => n + widthOf(b, bold), 0) * size / 1000;
const pdfString = (bytes) => `(${bytes.map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('')})`;

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 56.7, FOOT = 34;
const WIDTH = PAGE_W - 2 * MARGIN;
const FONT = { R: 'F1', B: 'F2', I: 'F3', BI: 'F4' };
const face = (r) => (r.b && r.i ? 'BI' : r.b ? 'B' : r.i ? 'I' : 'R');
const fmt = (n) => (Math.round(n * 100) / 100).toString();

/** The document src/exporter.js makes → the bytes of a PDF. */
export function writePDF(doc, { boxes = true, title = '' } = {}) {
  const pages = [];
  let ops = null, y = 0;
  const newPage = () => { ops = []; pages.push(ops); y = PAGE_H - MARGIN; };
  newPage();
  const atTop = () => y >= PAGE_H - MARGIN - 0.01;
  /* room for h points below y, or a new page */
  const need = (h) => { if (y - h < MARGIN + FOOT * 0.5 && !atTop()) newPage(); };
  const space = (h) => { if (!atTop()) y -= h; };

  /* runs of { text, b, i, u, s } → lines of pieces that fit the width */
  const wrap = (runs, size, room) => {
    const width = room * 0.985;
    const lines = [[]];
    let w = 0;
    const push = (bytes, r) => { const pw = measure(bytes, r.b, size); lines.at(-1).push({ bytes, r, w: pw }); w += pw; };
    for (const r of runs) {
      for (const tok of r.text.replace(/\t/g, ' ').match(/\S+|\s+/g) || []) {
        let bytes = bytesOf(tok);
        if (/^\s+$/.test(tok)) { if (lines.at(-1).length) push([32], r); continue; }
        let tw = measure(bytes, r.b, size);
        if (w + tw > width && lines.at(-1).length) {
          while (lines.at(-1).length && lines.at(-1).at(-1).bytes.every((b) => b === 32)) { w -= lines.at(-1).pop().w; }
          lines.push([]); w = 0;
        }
        while (tw > width) {          // a word longer than the line: cut where it no longer fits
          let n = 1;
          while (n < bytes.length && measure(bytes.slice(0, n + 1), r.b, size) <= width - w) n++;
          push(bytes.slice(0, n), r);
          lines.push([]); w = 0;
          bytes = bytes.slice(n); tw = measure(bytes, r.b, size);
        }
        if (bytes.length) push(bytes, r);
      }
    }
    return lines.filter((l, i) => l.length || i === 0);
  };
  const drawLine = (pieces, x, size, gray) => {
    if (gray) ops.push(`${gray} g ${gray} G`);
    for (const p of pieces) {
      if (!p.bytes.every((b) => b === 32)) ops.push(`BT /${FONT[face(p.r)]} ${fmt(size)} Tf ${fmt(x)} ${fmt(y)} Td ${pdfString(p.bytes)} Tj ET`);
      if (p.r.u) ops.push(`${fmt(size / 16)} w ${fmt(x)} ${fmt(y - size * 0.15)} m ${fmt(x + p.w)} ${fmt(y - size * 0.15)} l S`);
      if (p.r.s) ops.push(`${fmt(size / 16)} w ${fmt(x)} ${fmt(y + size * 0.3)} m ${fmt(x + p.w)} ${fmt(y + size * 0.3)} l S`);
      x += p.w;
    }
    if (gray) ops.push('0 g 0 G');
  };
  /* a paragraph: its lines, each moving down by the leading */
  const paragraph = (runs, { size, leading, x = MARGIN, width = WIDTH, gray = 0, keep = 0 }) => {
    const lines = wrap(runs, size, width);
    need(leading * Math.min(lines.length, 2) + keep);
    for (const line of lines) {
      need(leading);
      y -= leading;
      drawLine(line, x, size, gray);
    }
  };
  const plain = (text, extra = {}) => [{ text, b: false, i: false, u: false, s: false, ...extra }];

  for (const b of doc) {
    space(20);
    paragraph(plain(b.board || 'Board', { b: true }), { size: 18, leading: 22, keep: 40 });
    y -= 4;
    for (const g of b.groups) {
      if (g.list !== null) { space(12); paragraph(plain(g.list || 'No list', { b: true }), { size: 13, leading: 17, keep: 34 }); }
      for (const task of g.tasks) {
        space(10);
        const more = task.lines.length || task.subtasks.length ? 16 : 0;
        paragraph(plain(task.title, { b: true }), { size: 11, leading: 14, keep: (task.meta.length ? 12 : 0) + more });
        if (task.meta.length) paragraph(plain(task.meta.join(' · ')), { size: 9, leading: 12, gray: 0.4, keep: more });
        if (task.lines.length) {
          y -= 3;
          for (const runs of task.lines) paragraph(runs.length ? runs : plain(''), { size: 10, leading: 13 });
        }
        if (task.subtasks.length) y -= 2;
        for (const s of task.subtasks) {
          const indent = 14;
          const lines = wrap(plain(boxes ? s.title : `${s.title}${s.done ? ' (done)' : ''}`), 10, WIDTH - indent);
          lines.forEach((line, i) => {
            need(13);
            y -= 13;
            if (i === 0) {
              if (boxes) {
                ops.push(`0.7 w ${fmt(MARGIN + 0.5)} ${fmt(y - 0.6)} 7.4 7.4 re S`);
                if (s.done) ops.push(`1 w 1 J 1 j ${fmt(MARGIN + 2)} ${fmt(y + 3.2)} m ${fmt(MARGIN + 3.8)} ${fmt(y + 1.2)} l ${fmt(MARGIN + 7)} ${fmt(y + 6)} l S 0 J 0 j`);
              } else ops.push(`BT /F1 10 Tf ${fmt(MARGIN + 2)} ${fmt(y)} Td (\\225) Tj ET`);
            }
            drawLine(line, MARGIN + indent, 10, 0);
          });
        }
      }
    }
  }

  /* the files' objects: 1 catalog, 2 pages, 3 to 6 the faces, 7 information, then a page and its content each */
  const objects = [];
  const kids = pages.map((_, i) => `${8 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (const name of ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']) objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
  const utf16 = [...String(title).slice(0, 200)].flatMap((c) => { const n = c.charCodeAt(0); return [n >> 8, n & 255]; }).map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  objects.push(`<< /Title <FEFF${utf16}> /Producer (Stack'd) >>`);
  pages.forEach((page, i) => {
    const foot = bytesOf(`${i + 1} / ${pages.length}`);
    const content = [...page, `0.4 g BT /F1 8 Tf ${fmt((PAGE_W - measure(foot, false, 8)) / 2)} ${fmt(FOOT - 8)} Td ${pdfString(foot)} Tj ET 0 g`].join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${9 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);   // ASCII throughout
}
