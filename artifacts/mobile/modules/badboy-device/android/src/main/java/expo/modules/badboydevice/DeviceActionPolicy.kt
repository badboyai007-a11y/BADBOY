package expo.modules.badboydevice

internal object DeviceActionPolicy {
  val apps = mapOf(
    "youtube" to "com.google.android.youtube",
    "chrome" to "com.android.chrome",
    "gmail" to "com.google.android.gm",
    "maps" to "com.google.android.apps.maps",
    "whatsapp" to "com.whatsapp",
    "telegram" to "org.telegram.messenger"
  )

  fun appPackage(id: String): String? = apps[id]

  fun settingsAction(id: String): String? = when (id) {
    "wifi" -> android.provider.Settings.ACTION_WIFI_SETTINGS
    "bluetooth" -> android.provider.Settings.ACTION_BLUETOOTH_SETTINGS
    "sound" -> android.provider.Settings.ACTION_SOUND_SETTINGS
    "app" -> android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS
    "notifications" -> android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS
    else -> null
  }

  fun validReminder(id: String, title: String, body: String, timestamp: Long, now: Long): Boolean =
    id.matches(Regex("[A-Za-z0-9_-]{1,80}")) &&
      title.isNotBlank() && title.length <= 80 &&
      body.length <= 240 &&
      timestamp > now + 5_000L
}
