/* Checks for src/transcript.js (PRD-meetings US-06: pasted, .vtt and .srt
   transcripts, speaker labels, display merging, the model text) — `npm run
   check`. Pure string module, so no browser stand-ins are needed. */
import assert from 'node:assert/strict';
import {
  parseTime, parseVTT, parseSRT, parsePasted, parseByName, speakerName, mergeAdjacent, toModelText,
} from '../src/transcript.js';

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

console.log('check-transcript: ok');
