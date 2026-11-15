package expo.modules.badboydevice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CalendarContract
import android.provider.Settings
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BadboyDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BadboyDevice")

    AsyncFunction("scheduleReminder") { id: String, title: String, body: String, atMillis: Double ->
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      val at = atMillis.toLong()
      if (!DeviceActionPolicy.validReminder(id, title, body, at, System.currentTimeMillis())) {
        throw IllegalArgumentException("Reminder details are invalid or the time is too soon.")
      }
      if (Build.VERSION.SDK_INT >= 33 &&
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        throw SecurityException("Notification permission is required before scheduling reminders.")
      }
      ReminderScheduler.schedule(context, id, title, body, at)
      mapOf("id" to id, "scheduledAt" to at, "delivery" to "inexact")
    }

    AsyncFunction("cancelReminder") { id: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      if (!id.matches(Regex("[A-Za-z0-9_-]{1,80}"))) throw IllegalArgumentException("Invalid reminder id.")
      ReminderScheduler.cancel(context, id)
      true
    }

    AsyncFunction("openCalendarDraft") { title: String, startMillis: Double, endMillis: Double ->
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      val start = startMillis.toLong()
      val end = endMillis.toLong()
      if (title.isBlank() || title.length > 120 || start <= System.currentTimeMillis() || end <= start || end - start > 86_400_000L) {
        throw IllegalArgumentException("Calendar event details are invalid.")
      }
      val intent = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.Events.TITLE, title)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    AsyncFunction("openAllowedApp") { appId: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      val packageName = DeviceActionPolicy.appPackage(appId)
        ?: throw IllegalArgumentException("This app is not in Badboy's approved launch list.")
      val launch = context.packageManager.getLaunchIntentForPackage(packageName)
        ?: throw IllegalStateException("The selected app is not installed.")
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(launch)
      true
    }

    AsyncFunction("openDeviceSettings") { settingId: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      val action = DeviceActionPolicy.settingsAction(settingId)
        ?: throw IllegalArgumentException("This settings screen is not allowed.")
      val intent = if (settingId == "app") {
        Intent(action, Uri.parse("package:" + context.packageName))
      } else Intent(action)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }
  }
}
