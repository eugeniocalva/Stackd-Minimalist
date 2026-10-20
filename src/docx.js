/* A .docx is a zip; the text lives in word/document.xml. This is the
   smallest zip reader that gets that one entry out (PRD-meetings AC-06.6,
   architecture Phase 21): walk the central directory at the end of the
   file, find the entry, inflate it with the platform's DecompressionStream
   ('deflate-raw'). No dependency, no DOM, so scripts/check-transcript.mjs
   runs it under Node against a zip it builds itself. */

const SIG_EOCD = 0x06054b50, SIG_CENTRAL = 0x02014b50, SIG_LOCAL = 0x04034b50;
const utf8 = new TextDecoder('utf-8');

export const canInflate = () => typeof DecompressionStream !== 'undefined';

/** The zip's entries: { name, method, compressedSize, size, offset } */
export function entries(buffer) {
  const v = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 65535); i--) {
    if (v.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== SIG_CENTRAL) throw new Error('bad central directory');
    const method = v.getUint16(p + 10, true);
    const compressedSize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The raw (still compressed) bytes of one entry. */
function rawData(buffer, entry) {
  const v = new DataView(buffer);
  if (v.getUint32(entry.offset, true) !== SIG_LOCAL) throw new Error('bad local header');
  const nameLen = v.getUint16(entry.offset + 26, true), extraLen = v.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  return new Uint8Array(buffer, start, entry.compressedSize);
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The text of one entry (stored or deflated), or null when absent. */
export async function readEntry(buffer, name) {
  const entry = entries(buffer).find((e) => e.name === name);
  if (!entry) return null;
  const raw = rawData(buffer, entry);
  if (entry.method === 0) return utf8.decode(raw);
  if (entry.method === 8) {
    if (!canInflate()) throw new Error('This browser cannot read Word files; paste the text instead.');
    return utf8.decode(await inflate(raw));
  }
  throw new Error(`unsupported compression ${entry.method}`);
}

/** word/document.xml of a .docx, or null when the file is not one. */
export const readDocumentXml = (buffer) => readEntry(buffer, 'word/document.xml');
