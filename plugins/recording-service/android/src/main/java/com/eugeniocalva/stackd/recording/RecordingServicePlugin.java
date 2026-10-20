package com.eugeniocalva.stackd.recording;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * start(): make sure the microphone permission is granted (the WebView's
 * getUserMedia needs the app-level grant too), ask for the notification
 * permission on Android 13+ (optional: the service runs without it, the
 * notification is just hidden), then start the foreground service.
 * stop(): stop it. The recording itself happens in the WebView.
 */
@CapacitorPlugin(
    name = "RecordingService",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class RecordingServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneResult");
            return;
        }
        startWithMicrophone(call);
    }

    @PermissionCallback
    private void microphoneResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission denied", "denied");
            return;
        }
        startWithMicrophone(call);
    }

    private void startWithMicrophone(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsResult");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        launch(call); // granted or not: the service may run without a visible notification
    }

    private void launch(PluginCall call) {
        Intent intent = new Intent(getContext(), RecordingService.class);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), RecordingService.class));
        call.resolve();
    }
}
