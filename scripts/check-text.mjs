/* Checks for src/richtext.js (note bodies: sanitised HTML subset) — `npm run
   check`. Pure string module, so no browser stand-ins are needed. */
import assert from 'node:assert/strict';
import { ALLOWED_TAGS, sanitize, fromPlain, toText, firstLine, isEmpty, FORMATS, SHORTCUTS } from '../src/richtext.js';

assert.deepEqual(ALLOWED_TAGS, ['br', 'b', 'i', 'u', 's']);
assert.deepEqual(FORMATS.map((f) => f[0]), ['bold', 'italic', 'underline', 'strikeThrough']);
assert.deepEqual(Object.values(SHORTCUTS), ['bold', 'italic', 'underline', 'strikeThrough']);

// plain text passes through; stray angle brackets and ampersands are escaped
assert.equal(sanitize('hello'), 'hello');
assert.equal(sanitize('a < b & c'), 'a &lt; b &amp; c');
assert.equal(sanitize('5 &amp; 6 &lt; 7'), '5 &amp; 6 &lt; 7');       // entities kept as entities

// line breaks: <br> variants, block boundaries (contenteditable's <div>s), collapsed and trimmed
assert.equal(sanitize('one<br>two'), 'one<br>two');
assert.equal(sanitize('one<br/>two<BR />three'), 'one<br>two<br>three');
assert.equal(sanitize('<div>one</div><div>two</div>'), 'one<br>two');
assert.equal(sanitize('<div>one</div><div><br></div><div>two</div>'), 'one<br><br>two');
assert.equal(sanitize('<p>one</p><p>two</p>'), 'one<br>two');
assert.equal(sanitize('<br><br>one<br><br><br>two<br><br>'), 'one<br><br>two');
assert.equal(sanitize('<div><br></div>'), '');

// the four inline styles survive, their synonyms are mapped, everything else goes (text stays)
assert.equal(sanitize('<b>bold</b> and <i>it</i>'), '<b>bold</b> and <i>it</i>');
assert.equal(sanitize('<strong>s</strong> <em>e</em> <strike>k</strike> <del>d</del> <u>u</u>'), '<b>s</b> <i>e</i> <s>k</s> <s>d</s> <u>u</u>');
assert.equal(sanitize('<b class="x" style="color:red" onclick="evil()">bold</b>'), '<b>bold</b>', 'attributes on inline tags are dropped');
assert.equal(sanitize('<b><i>both</i></b> <i><u>two</u></i>'), '<b><i>both</i></b> <i><u>two</u></i>', 'nesting kept');
assert.equal(sanitize('<b>open'), '<b>open</b>', 'unclosed tags are closed');
assert.equal(sanitize('<b><i>x</b>y</i>'), '<b><i>x</i></b>y', 'mis-nesting is balanced, stray closers ignored');
assert.equal(sanitize('<b></b>a<i> </i>b'), 'a<i> </i>b', 'empty inline tags are dropped');
assert.equal(sanitize('<b>text<br></b>'), '<b>text</b>', 'a trailing break inside a tag is trimmed');
assert.equal(sanitize('<b>a</b><b>b</b>'), '<b>a</b><b>b</b>');
// what contenteditable produces (Chrome) and what gets pasted (web page, Word)
assert.equal(sanitize('<div><b>a</b></div><div><br></div><div>b</div>'), '<b>a</b><br><br>b');
assert.equal(sanitize('<b>bold<div>next line</div></b>'), '<b>bold<br>next line</b>');
assert.equal(sanitize('<h1>Title</h1><p>Some <strong>bold</strong>, <em>it</em> and <a href="https://x.y" target="_blank">a link</a>.</p><ul><li>one</li><li>two</li></ul>'),
  'Title<br>Some <b>bold</b>, <i>it</i> and a link.<br>one<br>two');
assert.equal(sanitize('<p class=MsoNormal><b><span style=\'font-size:12.0pt;font-family:"Calibri"\'>Bold</span></b> plain<o:p></o:p></p><p class=MsoNormal><u>under</u></p>'),
  '<b>Bold</b> plain<br><u>under</u>');
assert.equal(sanitize('<span style="font-weight:bold">css bold</span>'), 'css bold', 'CSS-only styling is not kept (tags only)');
assert.equal(sanitize('<a href="https://x" onclick="evil()">link</a>'), 'link');
assert.equal(sanitize('<img src=x onerror=alert(1)>pic'), 'pic');
assert.equal(sanitize('<script>alert(1)</script>safe<style>p{}</style>'), 'safe');
assert.equal(sanitize('<!-- c -->text<span style="color:red">red</span>'), 'textred');
assert.equal(sanitize('<br onclick="x()">a'), 'a');                       // attributes on br are dropped too

// idempotent
for (const s of ['one<br>two', 'a &lt; b', '<div>x</div><div>y</div>', '<b>q</b> &amp; r', '<b><i>x</i></b><br><u>y</u>', '<b>open', '<b><i>x</b>y</i>']) {
  assert.equal(sanitize(sanitize(s)), sanitize(s));
}

// null / undefined are empty bodies
assert.equal(sanitize(null), '');
assert.equal(sanitize(undefined), '');

// plain text → body
assert.equal(fromPlain('a\nb\r\nc'), 'a<br>b<br>c');
assert.equal(fromPlain('<not a tag> & co'), '&lt;not a tag&gt; &amp; co');

// body → text: breaks become newlines, entities decode, tags vanish
assert.equal(toText('one<br>two'), 'one\ntwo');
assert.equal(toText('<div>one</div><div>two</div>'), 'one\ntwo');
assert.equal(toText('a &lt; b &amp; c &#39;d&#39; &#x41;'), "a < b & c 'd' A");
assert.equal(toText('<b>bold</b> x'), 'bold x');
assert.equal(toText('<b><i>a</i></b><br><u>b</u> <s>c</s>'), 'a\nb c', 'styles never reach search or previews');
assert.equal(toText('<script>no</script>yes'), 'yes');
assert.equal(toText(fromPlain('round\ntrip')), 'round\ntrip');

// helpers used by rows and the Add button
assert.equal(firstLine('<br>  <br>second<br>third'), 'second');
assert.equal(firstLine(''), '');
assert.equal(isEmpty(''), true);
assert.equal(isEmpty('<br>'), true);
assert.equal(isEmpty('   '), true);
assert.equal(isEmpty('&nbsp;'), true);
assert.equal(isEmpty('x'), false);

// search matching (src/search.js): case- and accent-insensitive, every term must hit
const { normalize, matches, filterTasks, filterNotes } = await import('../src/search.js');
assert.equal(normalize('Café À-la-carte'), 'cafe a-la-carte');
assert.equal(matches('', ['anything']), true);
assert.equal(matches('  ', ['anything']), true);
assert.equal(matches('cafe', ['Café']), true);
assert.equal(matches('CAFÉ', ['cafe']), true);
assert.equal(matches('budget review', ['Agenda', 'budget', 'Review notes']), true, 'terms may hit different fields');
assert.equal(matches('budget review', ['budget only']), false);
const tasks = [
  { title: 'Email vendor', tags: ['Vendor'], subtasks: [] },
  { title: 'Plan trip', tags: [], subtasks: [{ title: 'Book hotel' }] },
  { title: 'Water plants', tags: ['home'], subtasks: [] },
];
assert.deepEqual(filterTasks(tasks, '').map((t) => t.title), ['Email vendor', 'Plan trip', 'Water plants']);
assert.deepEqual(filterTasks(tasks, 'vendor').map((t) => t.title), ['Email vendor']);
assert.deepEqual(filterTasks(tasks, 'hotel').map((t) => t.title), ['Plan trip'], 'subtask titles count');
assert.deepEqual(filterTasks(tasks, 'home').map((t) => t.title), ['Water plants'], 'tags count');
const notes = [
  { title: 'Weekly sync', body: 'Agenda for <b>Monday</b><br>Budget', tags: ['meeting'], checklist: [{ text: 'Pull numbers' }] },
  { title: '', body: 'Café ideas', tags: ['food'], checklist: null },
  { title: 'Shopping', body: '', tags: ['food', 'home'], checklist: [{ text: 'Milk' }] },
];
assert.deepEqual(filterNotes(notes, '', null).length, 3);
assert.deepEqual(filterNotes(notes, 'monday').map((n) => n.title), ['Weekly sync'], 'body text, tags stripped');
assert.deepEqual(filterNotes(notes, 'numbers').map((n) => n.title), ['Weekly sync'], 'checklist text counts');
assert.deepEqual(filterNotes(notes, 'cafe').map((n) => n.body), ['Café ideas']);
assert.deepEqual(filterNotes(notes, '', 'Food').map((n) => n.tags[0]), ['food', 'food'], 'tag filter is case-insensitive');
assert.deepEqual(filterNotes(notes, 'milk', 'food').map((n) => n.title), ['Shopping'], 'tag AND query');
assert.deepEqual(filterNotes(notes, 'monday', 'food'), [], 'tag AND query: no cross match');

console.log('check-text: ok');
