const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Keep the app installable on Android 7.0+ (API 24) and newer.
 * Expo SDK 57 uses compile/target SDK 36; this mod changes only the
 * generated app module's minSdkVersion to API 24 and leaves compile/target intact.
 */
module.exports = function withAndroidMinSdk(config) {
  return withAppBuildGradle(config, (config) => {
    const original = config.modResults.contents;
    const updated = original.replace(
      /(\bminSdkVersion\s+)([^\n;]+)/,
      "$1" + "24"
    );
    if (updated === original) {
      throw new Error(
        "with-android-min-sdk: could not find minSdkVersion in android/app/build.gradle"
      );
    }
    config.modResults.contents = updated;
    return config;
  });
};
