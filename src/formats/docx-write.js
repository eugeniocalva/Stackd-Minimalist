/* A Word file (.docx) written by hand (PRD 1.7.0 §06.2, decision 52): a
   true Word document, so Word, Pages and Google Docs open it as one. A
   heading a board, a heading a list when grouped by list, and each task as
   a bold title, a grey line of what is known about it, its description
   with its bold, italic, underlined and struck text, and its subtasks as
   boxes or as a plain list (decision 20). The headings are Word's own
   Heading 1 and Heading 2, so the navigation pane lists them. A4, no cover
   page, no colour. Pure: given the document src/exporter.js makes. */

import { xmlText } from './xml.js';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const t = (s) => `<w:t xml:space="preserve">${xmlText(s)}</w:t>`;
const run = (s, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${t(s)}</w:r>`;
const para = (style, inner) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inner}</w:p>`;

const STYLES = `${XML}<w:styles xmlns:w="${W}">`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>'
  + '<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/>'
  + '<w:pPr><w:keepNext/><w:spacing w:before="280" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TaskTitle"><w:name w:val="Task title"/><w:basedOn w:val="Normal"/><w:qFormat/>'
  + '<w:pPr><w:keepNext/><w:spacing w:before="200"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TaskMeta"><w:name w:val="Task details"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:keepNext/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TaskText"><w:name w:val="Task description"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:spacing w:before="60"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Subtask"><w:name w:val="Subtask"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:spacing w:before="40"/><w:ind w:left="284" w:hanging="284"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
  + '</w:styles>';

/** The document src/exporter.js makes → the bytes of a .docx. */
export function writeDOCX(doc, { boxes = true, zip }) {
  const body = [];
  for (const b of doc) {
    body.push(para('Heading1', run(b.board || 'Board')));
    for (const g of b.groups) {
      if (g.list !== null) body.push(para('Heading2', run(g.list || 'No list')));
      for (const task of g.tasks) {
        body.push(para('TaskTitle', run(task.title)));
        if (task.meta.length) body.push(para('TaskMeta', run(task.meta.join(' · '))));
        if (task.lines.length) {
          const inner = task.lines.map((runs, i) => (i ? '<w:r><w:br/></w:r>' : '') + runs.map((r) => run(r.text, `${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.s ? '<w:strike/>' : ''}${r.u ? '<w:u w:val="single"/>' : ''}`)).join('')).join('');
          body.push(para('TaskText', inner));
        }
        for (const s of task.subtasks) {
          body.push(para('Subtask', boxes
            ? `${run(s.done ? '☑' : '☐', '<w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/>')}${run('\t')}${run(s.title)}`
            : `${run('•\t')}${run(s.title)}${s.done ? run(' (done)', '<w:color w:val="666666"/>') : ''}`));
        }
      }
    }
  }
  const document = `${XML}<w:document xmlns:w="${W}" xmlns:r="${REL}"><w:body>${body.join('')}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
  return zip([
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'],
    ['_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', document],
    ['word/_rels/document.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/settings" Target="settings.xml"/></Relationships>`],
    ['word/styles.xml', STYLES],
    /* without this, Word opens the file in Compatibility Mode, as if an older Word had made it */
    ['word/settings.xml', `${XML}<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="284"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`],
  ]);
}
