package expo.modules.badboydevice

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

internal object ReminderScheduler {
  const val CHANNEL_ID = "badboy_reminders"
  const val ACTION_FIRE = "expo.modules.badboydevice.REMINDER_FIRE"
  private const val PREFS = "badboy_local_reminders"

  fun schedule(context: Context, id: String, title: String, body: String, at: Long) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val prefix = "reminder.$id."
    prefs.edit()
      .putString(prefix + "title", title)
      .putString(prefix + "body", body)
      .putLong(prefix + "at", at)
      .apply()
    val intent = Intent(context, ReminderReceiver::class.java)
      .setAction(ACTION_FIRE)
      .putExtra("id", id)
      .putExtra("title", title)
      .putExtra("body", body)
    val pending = PendingIntent.getBroadcast(
      context, id.hashCode(), intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
  }

  fun cancel(context: Context, id: String) {
    val intent = Intent(context, ReminderReceiver::class.java)
      .setAction(ACTION_FIRE)
      .putExtra("id", id)
    val pending = PendingIntent.getBroadcast(
      context, id.hashCode(), intent,
      PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
    )
    if (pending != null) {
      (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending)
      pending.cancel()
    }
    val prefix = "reminder.$id."
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(prefix + "title").remove(prefix + "body").remove(prefix + "at").apply()
  }

  fun restore(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val ids = prefs.all.keys
      .filter { it.startsWith("reminder.") && it.endsWith(".at") }
      .map { it.removePrefix("reminder.").removeSuffix(".at") }
    val now = System.currentTimeMillis()
    ids.forEach { id ->
      val prefix = "reminder.$id."
      val at = prefs.getLong(prefix + "at", 0L)
      val title = prefs.getString(prefix + "title", null)
      val body = prefs.getString(prefix + "body", "") ?: ""
      if (at > now && !title.isNullOrBlank()) schedule(context, id, title, body, at)
      else cancel(context, id)
    }
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = context.getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Badboy reminders", NotificationManager.IMPORTANCE_DEFAULT)
      )
    }
  }
}

class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ReminderScheduler.ACTION_FIRE) return
    val id = intent.getStringExtra("id") ?: return
    val title = intent.getStringExtra("title") ?: "Badboy reminder"
    val body = intent.getStringExtra("body") ?: ""
    ReminderScheduler.ensureChannel(context)
    val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, ReminderScheduler.CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(title)
      .setContentText(body)
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_REMINDER)
      .build()
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(id.hashCode(), notification)
    val prefix = "reminder.$id."
    context.getSharedPreferences("badboy_local_reminders", Context.MODE_PRIVATE).edit()
      .remove(prefix + "title").remove(prefix + "body").remove(prefix + "at").apply()
  }
}

class ReminderBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      ReminderScheduler.restore(context)
    }
  }
}
