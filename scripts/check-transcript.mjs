/* Checks for src/transcript.js (PRD-meetings US-06: pasted, .vtt and .srt
   transcripts, speaker labels, display merging, the model text) — `npm run
   check`. Pure string module, so no browser stand-ins are needed. */
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  parseTime, parseVTT, parseSRT, parsePasted, parseByName, parseDocxXml, speakerName, mergeAdjacent, toModelText,
} from '../src/transcript.js';
import { entries, readEntry, readDocumentXml } from '../src/docx.js';

const who = (r) => r.segments.map((s) => `${speakerName(r, s.speaker)}@${s.startMs}:${s.text}`);

// times
assert.equal(parseTime('00:12'), 12000);
assert.equal(parseTime('1:02:03'), 3723000);
assert.equal(parseTime('00:00:03.510'), 3510);
assert.equal(parseTime('00:00:03,5'), 3500);
assert.equal(parseTime('10:32 AM'), null);
assert.equal(parseTime('abc'), null);

// WebVTT with Teams-style voice tags
const vtt = `WEBVTT

NOTE made by Teams

1
00:00:03.510 --> 00:00:05.370
<v Eugenio Calvaresi>Hello everyone</v>

00:00:05.400 --> 00:00:08.000
<v Marco Rossi>Hi, <c.loud>good</c> morning</v>

00:00:09.000 --> 00:00:10.000
<v Eugenio Calvaresi>Let's start.</v>
`;
let r = parseVTT(vtt);
assert.deepEqual(r.speakers, { S1: 'Eugenio Calvaresi', S2: 'Marco Rossi' });
assert.deepEqual(who(r), ['Eugenio Calvaresi@3510:Hello everyone', 'Marco Rossi@5400:Hi, good morning', "Eugenio Calvaresi@9000:Let's start."]);

// WebVTT without voices: one 'Transcript' speaker, times kept
r = parseVTT('WEBVTT\n\n00:01.000 --> 00:02.000\nfirst\n\n00:03.000 --> 00:04.000\nsecond line\nmore');
assert.deepEqual(r.speakers, { S1: 'Transcript' });
assert.deepEqual(who(r), ['Transcript@1000:first', 'Transcript@3000:second line\nmore']);
assert.equal(speakerName(r, 'S1'), 'Transcript');

// SRT, "Name: text" on the first line is a speaker
r = parseSRT('1\r\n00:00:12,000 --> 00:00:15,000\r\nAnna: We agreed on Friday.\r\n\r\n2\r\n00:00:16,000 --> 00:00:18,000\r\nBob: Fine by me\r\n');
assert.deepEqual(r.speakers, { S1: 'Anna', S2: 'Bob' });
assert.deepEqual(who(r), ['Anna@12000:We agreed on Friday.', 'Bob@16000:Fine by me']);

// pasted: the three shapes
r = parsePasted('[00:12] Marco: hello\nAnna: hi there\nstill Anna\n(01:05) Marco: bye');
assert.deepEqual(r.speakers, { S1: 'Marco', S2: 'Anna' });
assert.deepEqual(who(r), ['Marco@12000:hello', 'Anna@null:hi there still Anna', 'Marco@65000:bye']);
r = parsePasted('Marco Rossi  00:12\nFirst thing.\nSecond thing.\n\nAnna  10:32 AM\nReply');
assert.deepEqual(r.speakers, { S1: 'Marco Rossi', S2: 'Anna' });
assert.deepEqual(who(r), ['Marco Rossi@12000:First thing. Second thing.', 'Anna@null:Reply']);
// pasted: "Name (00:12): text" (Zoom / Otter exports)
r = parsePasted('Marco (00:12): one\nAnna [01:05:09]: two');
assert.deepEqual(who(r), ['Marco@12000:one', 'Anna@3909000:two']);
// pasted: no shape at all → one segment, labelled Transcript, no times
r = parsePasted('Just some notes\nover two lines\n\nand a paragraph');
assert.deepEqual(r.speakers, { S1: 'Transcript' });
assert.equal(r.segments.length, 1);
assert.equal(r.segments[0].text, 'Just some notes\nover two lines\n\nand a paragraph');
assert.equal(r.segments[0].startMs, null);
// pasted: a "Note:" line or a URL is not a speaker
r = parsePasted('Note: remember the deck\nhttps://example.com/x: nope');
assert.deepEqual(r.speakers, { S1: 'Transcript' });
// empty
assert.deepEqual(parsePasted('   \n\n').segments, []);

// default labels when the source gives no names
r = { speakers: { S1: null, S2: 'Zoe', S3: null } };
assert.equal(speakerName(r, 'S1'), 'Speaker 1');
assert.equal(speakerName(r, 'S2'), 'Zoe');
assert.equal(speakerName(r, 'S3'), 'Speaker 3');

// by file name
assert.deepEqual(parseByName('teams.VTT', vtt).speakers, { S1: 'Eugenio Calvaresi', S2: 'Marco Rossi' });
assert.deepEqual(parseByName('x.srt', '1\n00:00:01,000 --> 00:00:02,000\nhi\n').speakers, { S1: 'Transcript' });
assert.deepEqual(parseByName('notes.txt', 'A: one\nB: two').speakers, { S1: 'A', S2: 'B' });

// display merge: consecutive same speaker reads as one, first id and time kept
const segs = [
  { id: 'a', speaker: 'S1', startMs: 0, text: 'one' }, { id: 'b', speaker: 'S1', startMs: 1000, text: 'two' },
  { id: 'c', speaker: 'S2', startMs: 2000, text: 'three' }, { id: 'd', speaker: 'S1', startMs: 3000, text: 'four' },
];
assert.deepEqual(mergeAdjacent(segs).map((s) => `${s.id}:${s.startMs}:${s.text}`), ['a:0:one\ntwo', 'c:2000:three', 'd:3000:four']);
assert.equal(segs[0].text, 'one', 'merge does not mutate the stored segments');

// model text: time and name when known; neither name when the transcript has no speakers
assert.equal(toModelText({ speakers: { S1: null, S2: 'Zoe' }, segments: segs.slice(0, 3) }), '[00:00] Speaker 1: one\n[00:01] Speaker 1: two\n[00:02] Zoe: three');
assert.equal(toModelText({ speakers: { S1: 'Transcript' }, segments: [{ speaker: 'S1', startMs: null, text: 'a\nb' }] }), 'a b');

// docx: word/document.xml → lines; a real zip built here (stored and deflated entries)
const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:pPr/><w:r><w:t>Marco:</w:t></w:r><w:r><w:t xml:space="preserve"> Let&apos;s ship </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Friday</w:t></w:r></w:p>
<w:p><w:r><w:t>Anna: I need</w:t><w:tab/><w:t>numbers</w:t><w:br/><w:t>from finance &amp; ops</w:t></w:r></w:p>
<w:p/>
<w:p><w:r><w:delText>gone</w:delText><w:t>Marco: ok &#8211; fine</w:t></w:r></w:p>
</w:body></w:document>`;
assert.equal(parseDocxXml(xml), "Marco: Let's ship Friday\nAnna: I need\tnumbers\nfrom finance & ops\n\nMarco: ok – fine");
assert.deepEqual(who(parsePasted(parseDocxXml(xml))), ["Marco@null:Let's ship Friday", 'Anna@null:I need\tnumbers from finance & ops', 'Marco@null:ok – fine']);
function zip(files) {   // minimal writer: local headers + central directory + EOCD
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text, method] of files) {
    const nameB = enc.encode(name), data = enc.encode(text);
    const body = method === 8 ? deflateRawSync(data) : data;
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...nameB]);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB]));
    parts.push(local, body); offset += local.length + body.length;
  }
  const cdStart = offset; const cd = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd), ...u32(cdStart), ...u16(0)]);
  const all = new Uint8Array(offset + cd + eocd.length); let p = 0;
  for (const b of [...parts, ...central, eocd]) { all.set(b, p); p += b.length; }
  return all.buffer;
}
const docx = zip([['[Content_Types].xml', '<Types/>', 0], ['word/document.xml', xml, 8], ['word/styles.xml', '<styles/>', 8]]);
assert.deepEqual(entries(docx).map((e) => [e.name, e.method]), [['[Content_Types].xml', 0], ['word/document.xml', 8], ['word/styles.xml', 8]]);
assert.equal(await readEntry(docx, '[Content_Types].xml'), '<Types/>', 'a stored entry');
assert.equal(await readDocumentXml(docx), xml, 'a deflated entry inflates');
assert.equal(await readEntry(docx, 'nope.xml'), null);
assert.equal(await readDocumentXml(zip([['a.txt', 'not a docx', 0]])), null, 'a zip without the document');
assert.throws(() => entries(new TextEncoder().encode('plain text, not a zip').buffer), /not a zip/);

console.log('check-transcript: ok');
