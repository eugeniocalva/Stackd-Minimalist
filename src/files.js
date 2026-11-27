/* Handing a file to the person (PRD 1.7.0 §06). Every save in the Data
   section goes through saveFile(), so there is one place that knows what
   really happened.

   In a browser the file is given to the browser as a download. The app
   cannot know what the browser, or the person, then does with it: so the
   result says "handed", never "saved".

   In the iPhone and Android apps a download link does nothing. There the
   file is written to the app's cache with the Filesystem plugin and handed
   to the system's share sheet with the Share plugin (decision 13): Save to
   Files, Mail, AirDrop, another app. Closing the sheet without choosing is
   "cancelled", and the caller then says nothing and notes nothing. The copy
   in the cache is removed once the sheet has answered. Capacitor puts its
   plugins on window.Capacitor.Plugins before any page script runs, so they
   are used from there, with no import (a bare import would blank the app). */

const native = () => !!globalThis.Capacitor?.isNativePlatform?.();
const plugins = () => globalThis.Capacitor?.Plugins || {};

/* a Blob → base64, as the Filesystem plugin takes it */
async function base64Of(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function shareNative(blob, name) {
  const { Filesystem, Share } = plugins();
  if (!Filesystem?.writeFile || !Share?.share) return 'unavailable';
  const path = `exports/${name}`;
  const { uri } = await Filesystem.writeFile({ path, data: await base64Of(blob), directory: 'CACHE', recursive: true });
  try {
    await Share.share({ title: name, files: [uri], dialogTitle: name });
    return 'handed';
  } catch (e) {
    /* the person closed the sheet: not a failure, nothing to say */
    if (/cancel/i.test(String(e?.message ?? e))) return 'cancelled';
    throw e;
  } finally {
    Filesystem.deleteFile({ path, directory: 'CACHE' }).catch(() => {});
  }
}

/** @returns {Promise<'handed' | 'cancelled' | 'unavailable'>} Throws when writing the file failed. */
export async function saveFile(blob, name) {
  if (native()) return shareNative(blob, name);
  if (typeof document === 'undefined' || !globalThis.URL?.createObjectURL) return 'unavailable';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'handed';
}
