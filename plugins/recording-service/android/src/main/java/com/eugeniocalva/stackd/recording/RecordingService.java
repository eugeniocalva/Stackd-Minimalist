package com.eugeniocalva.stackd.recording;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * A foreground service of type "microphone" with an ongoing notification.
 * It records nothing: it keeps the process alive and tells the user, through
 * the system's own indicator, that the microphone is in use while the screen
 * is locked (PRD AC-04.3).
 */
public class RecordingService extends Service {

    static final String CHANNEL_ID = "stackd-recording";
    static final int NOTIFICATION_ID = 4101;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = open == null
            ? null
            : PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Recording")
            .setContentText("Stack'd is recording a meeting")
            .setSmallIcon(getApplicationInfo().icon)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(tap)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
        int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Recording", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shown while a meeting is being recorded");
        nm.createNotificationChannel(ch);
    }
}
