package expo.modules.badboydevice

import org.junit.Assert.*
import org.junit.Test

class DeviceActionPolicyTest {
  @Test fun onlyKnownAppsCanBeLaunched() {
    assertEquals("com.google.android.youtube", DeviceActionPolicy.appPackage("youtube"))
    assertNull(DeviceActionPolicy.appPackage("com.example.malware"))
    assertNull(DeviceActionPolicy.appPackage("../../settings"))
  }

  @Test fun onlyKnownSettingsScreensCanBeOpened() {
    assertEquals(android.provider.Settings.ACTION_WIFI_SETTINGS, DeviceActionPolicy.settingsAction("wifi"))
    assertNull(DeviceActionPolicy.settingsAction("arbitrary-intent"))
  }

  @Test fun reminderValidationRejectsInvalidAndPastRequests() {
    val now = 1_000_000L
    assertTrue(DeviceActionPolicy.validReminder("reminder_1", "Call home", "Call family", now + 60_000, now))
    assertFalse(DeviceActionPolicy.validReminder("bad/id", "Call home", "", now + 60_000, now))
    assertFalse(DeviceActionPolicy.validReminder("id", " ", "", now + 60_000, now))
    assertFalse(DeviceActionPolicy.validReminder("id", "x".repeat(81), "", now + 60_000, now))
    assertFalse(DeviceActionPolicy.validReminder("id", "Call", "", now, now))
  }
}
