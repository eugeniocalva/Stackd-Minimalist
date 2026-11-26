/* Handing a file to the person (PRD 1.7.0 §06). Every save in the Data
   section goes through saveFile(), so there is one place that knows what
   really happened and one place to change when the iPhone and Android apps
   get their own way of saving (the Filesystem and Share plugins, decision
   13, wired in phase 8).

   In a browser the file is given to the browser as a download. The app
   cannot know what the browser, or the person, then does with it: so the
   result says "handed", never "saved". Inside a native shell a download
   link does nothing, and until phase 8 there is nothing else: the result
   says so, and the caller must not claim that a file exists. */

const native = () => !!globalThis.Capacitor?.isNativePlatform?.();

/** @returns {'handed' | 'unavailable'} */
export function saveFile(blob, name) {
  if (native() || typeof document === 'undefined' || !globalThis.URL?.createObjectURL) return 'unavailable';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'handed';
}
