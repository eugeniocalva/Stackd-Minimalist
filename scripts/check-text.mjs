/* Checks for src/richtext.js (note bodies: sanitised HTML subset) — `npm run
   check`. Pure string module, so no browser stand-ins are needed. Phase 7:
   the whitelist is <br> only; Phase 12 widens it and extends these. */
import assert from 'node:assert/strict';
import { ALLOWED_TAGS, sanitize, fromPlain, toText, firstLine, isEmpty } from '../src/richtext.js';

assert.deepEqual(ALLOWED_TAGS, ['br']);

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

// every other tag goes, its text stays; attributes and dangerous content never survive
assert.equal(sanitize('<b>bold</b> and <i>it</i>'), 'bold and it');     // Phase 7: no inline styles yet
assert.equal(sanitize('<a href="https://x" onclick="evil()">link</a>'), 'link');
assert.equal(sanitize('<img src=x onerror=alert(1)>pic'), 'pic');
assert.equal(sanitize('<script>alert(1)</script>safe<style>p{}</style>'), 'safe');
assert.equal(sanitize('<!-- c -->text<span style="color:red">red</span>'), 'textred');
assert.equal(sanitize('<br onclick="x()">a'), 'a');                       // attributes on br are dropped too

// idempotent
for (const s of ['one<br>two', 'a &lt; b', '<div>x</div><div>y</div>', '<b>q</b> &amp; r']) {
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

console.log('check-text: ok');
