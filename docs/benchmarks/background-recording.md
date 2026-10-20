# Device spike — recording while the screen is locked (Phase 19, PRD-meetings AC-04.3)

The one unknown the architecture flags first (§26): does `MediaRecorder`
inside the web view keep running when the phone locks, once iOS has the
`audio` background mode and Android runs the foreground service? This page
records the answer. Until it is filled in, the recorder in 1.5.0 is the
web implementation on every platform.

## How to run it

1. Build the app for the phone: the **iOS to TestFlight** workflow (dry run
   is enough to get a signed build onto a registered device through Xcode,
   or tick upload for TestFlight) and the **Android to Play** workflow
   (internal testing).
2. Open a meeting, tap Record, speak for a few seconds, then lock the
   phone. Leave it locked for **10 minutes**, talking or playing a podcast
   near it from time to time.
3. Unlock, open the app, tap Stop. Play the recording back.
4. Note what happened below, then push the change.

## Results

| Platform | Build | OS | Indicator while locked | Recording length | Audio continuous? | Verdict |
|---|---|---|---|---|---|---|
| iPhone | | iOS | orange dot: yes / no | mm:ss of 10:00 | yes / gaps / stopped at mm:ss | pass / fail |
| Android | | | notification: yes / no | mm:ss of 10:00 | yes / gaps / stopped at mm:ss | pass / fail |

## If iOS fails

The fallback in the architecture (§26): `plugins/recording-service` gains a
native iOS path (`AVAudioRecorder` writing `.m4a` in the app's documents
folder, returned to the web app as a Blob through the bridge when the
recording stops), `src/ui/recorder.js` uses it when
`Capacitor.getPlatform() === 'ios'`, and the level line reads the
recorder's metering instead of an `AnalyserNode`. The web code stays as
it is for the browser and for Android.

## If Android fails

Check that the foreground service's notification is shown (it means the
service is running) and that the app's battery setting is not
"Restricted". If the service runs and the WebView still pauses, the same
native path applies, with `MediaRecorder` from the Android SDK.
