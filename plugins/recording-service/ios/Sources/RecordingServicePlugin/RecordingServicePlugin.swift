import Foundation
import Capacitor

/// iOS keeps the WebView recording through the `audio` background mode in
/// Info.plist (set by .github/workflows/ios-testflight.yml), so both methods
/// resolve at once. Phase 19's device spike decides whether a native
/// AVAudioRecorder path is needed here (docs/architecture.md §26).
@objc(RecordingServicePlugin)
public class RecordingServicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RecordingServicePlugin"
    public let jsName = "RecordingService"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    @objc func start(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        call.resolve()
    }
}
