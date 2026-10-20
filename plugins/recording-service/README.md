# stackd-recording-service

A local Capacitor plugin (`"stackd-recording-service": "file:plugins/recording-service"`
in the root `package.json`) with two methods, reached from the web app the
way haptics and notifications are, through the bridge-injected
`globalThis.Capacitor.Plugins.RecordingService`:

| Method | Android | iOS | Web |
|---|---|---|---|
| `start()` | asks for the microphone permission (and, on Android 13+, the notification permission), then starts a **foreground service** of type `microphone` with an ongoing "Recording" notification, so the OS keeps the app alive while the screen is locked | resolves at once; the `audio` background mode in Info.plist (set by the iOS workflow) keeps the WebView recording | the plugin does not exist; callers guard on `Capacitor?.Plugins?.RecordingService` |
| `stop()` | stops the service and removes the notification | resolves at once | — |

`start()` rejects with code `denied` when the microphone permission is
refused. The service does no recording itself: `MediaRecorder` in the
WebView does, this only keeps the process in the foreground
(`docs/architecture.md` §18, §22; PRD AC-04.3).

Why a plugin and not a published one: the service needs the app's own
package, icon and notification text, and the whole thing is sixty lines.
If Phase 19's device spike shows that iOS stops `MediaRecorder` in the
background, the iOS side gains a native `AVAudioRecorder` path here
(`docs/architecture.md` §26).
