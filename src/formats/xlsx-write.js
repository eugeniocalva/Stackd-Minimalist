/* An Excel file (.xlsx) written by hand (PRD 1.7.0 §06.2): one sheet,
   "Tasks", the field names in bold on a first row that stays in place, a
   filter on every column, and dates as real dates in the person's date
   format, so Excel sorts and filters them. Text cells are written in the
   cell itself (inline strings): a text cell is never a formula, whatever
   it starts with. src/formats/xlsx.js reads what this writes, and
   scripts/check-export.mjs checks that it does. Pure. */

import { xmlText } from './xml.js';

const MAX_CELL = 32767;   // what a cell of Excel holds
const WIDTH = { board: 18, list: 16, title: 40, description: 50, labels: 20, priority: 12, due: 18, start: 14, done: 8, subtasks: 36, archived: 10, repeat: 10, reminder: 18, created: 18, completed: 18 };
const DAY_CODE = { dmy: 'dd/mm/yyyy', mdy: 'mm/dd/yyyy', ymd: 'yyyy-mm-dd' };
/* styles, by their place in cellXfs below */
const HEAD = 1, DATE = 2, DATETIME = 3, TEXT = 4, WRAP = 5;

/* Excel reads _x0041_ in a cell as the character it names: one written by a person is kept by escaping its _ */
const literal = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_');
const column = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
/** { date: '2026-12-01', time: '09:00' } → Excel's day number. */
const serial = ({ date, time }) => {
  const [y, m, d] = date.split('-').map(Number);
  const days = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  if (!time) return days;
  const [h, min] = time.split(':').map(Number);
  return days + (h * 60 + min) / 1440;
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function styles(dateFormat) {
  const day = DAY_CODE[dateFormat] || DAY_CODE.dmy;
  return `${XML}<styleSheet xmlns="${MAIN}">`
    + `<numFmts count="2"><numFmt numFmtId="164" formatCode="${day}"/><numFmt numFmtId="165" formatCode="${day} hh:mm"/></numFmts>`
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="6">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>'
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
    + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

/** records and fields as made by src/exporter.js → the bytes of a .xlsx. */
export function writeXLSX(records, fields, { label, text, rich, dateFormat, zip }) {
  const str = (ref, s, style) => {
    const t = String(s ?? '');
    return t === '' ? '' : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(literal(t.slice(0, MAX_CELL)))}</t></is></c>`;
  };
  /* formatted text in one cell: a run each piece, a line break between lines */
  const formatted = (ref, lines) => {
    if (!lines.length) return '';
    let room = MAX_CELL;
    const runs = [];
    lines.forEach((line, i) => {
      for (const r of i ? [{ text: '\n' }, ...line] : line) {
        if (room <= 0) break;
        const piece = r.text.slice(0, room);
        room -= piece.length;
        const props = `${r.b ? '<b/>' : ''}${r.i ? '<i/>' : ''}${r.s ? '<strike/>' : ''}${r.u ? '<u/>' : ''}<sz val="11"/><rFont val="Calibri"/><family val="2"/>`;
        runs.push(`<r><rPr>${props}</rPr><t xml:space="preserve">${xmlText(literal(piece))}</t></r>`);
      }
    });
    return `<c r="${ref}" s="${WRAP}" t="inlineStr"><is>${runs.join('')}</is></c>`;
  };
  const rows = [`<row r="1">${fields.map((k, i) => str(`${column(i)}1`, label[k], HEAD)).join('')}</row>`];
  records.forEach((r, n) => {
    const at = n + 2;
    rows.push(`<row r="${at}">${fields.map((k, i) => {
      const ref = `${column(i)}${at}`;
      const v = r[k];
      if (v && typeof v === 'object' && 'date' in v) return v.date >= '1900-03-01' ? `<c r="${ref}" s="${v.time ? DATETIME : DATE}"><v>${serial(v)}</v></c>` : str(ref, text(k, v), TEXT);
      if (k === 'description' && rich) return formatted(ref, rich(v));
      return str(ref, text(k, v), k === 'description' || k === 'subtasks' || k === 'title' ? WRAP : TEXT);
    }).join('')}</row>`);
  });
  const last = `${column(fields.length - 1)}${records.length + 1}`;
  const sheet = `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">`
    + `<dimension ref="A1:${last}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${fields.map((k, i) => `<col min="${i + 1}" max="${i + 1}" width="${WIDTH[k] || 14}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rows.join('')}</sheetData>`
    + `<autoFilter ref="A1:${last}"/>`
    + '</worksheet>';
  const workbook = `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews>`
    + '<sheets><sheet name="Tasks" sheetId="1" r:id="rId1"/></sheets>'
    + `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Tasks!$A$1:$${column(fields.length - 1)}$${records.length + 1}</definedName></definedNames>`
    + '</workbook>';
  return zip([
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles(dateFormat)],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}
