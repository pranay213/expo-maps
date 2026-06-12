const { withAndroidManifest, withProjectBuildGradle, createRunOncePlugin } = require('@expo/config-plugins');

const PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
];

function withOlaMapsPermissions(config) {
  return withAndroidManifest(config, async (cfg) => {
    const manifest = cfg.modResults;
    const mainManifest = manifest.manifest;

    if (!mainManifest['uses-permission']) {
      mainManifest['uses-permission'] = [];
    }

    const existing = new Set(
      mainManifest['uses-permission'].map((p) => p.$['android:name'])
    );

    for (const perm of PERMISSIONS) {
      if (!existing.has(perm)) {
        mainManifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    }

    return cfg;
  });
}

function withOlaMapsNavigationActivity(config) {
  return withAndroidManifest(config, async (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application[0];

    if (!app.activity) app.activity = [];

    const activityName = 'com.olamaps.NavigationActivity';
    const alreadyDeclared = app.activity.some(
      (a) => a.$['android:name'] === activityName
    );

    if (!alreadyDeclared) {
      app.activity.push({
        $: {
          'android:name': activityName,
          'android:exported': 'false',
          'android:configChanges': 'orientation|screenSize|keyboardHidden',
          'android:screenOrientation': 'portrait',
          'android:theme': '@style/NavigationTheme',
        },
      });
    }

    return cfg;
  });
}

function withOlaMapsRepositories(config) {
  return withProjectBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('rn-ola-maps/android/libs')) {
      const flatDirSnippet = `
allprojects {
    repositories {
        flatDir {
            dirs "\${rootDir}/../node_modules/rn-ola-maps/android/libs"
        }
    }
}
`;
      contents += flatDirSnippet;
      cfg.modResults.contents = contents;
    }
    return cfg;
  });
}

function withOlaMaps(config) {
  config = withOlaMapsPermissions(config);
  config = withOlaMapsNavigationActivity(config);
  config = withOlaMapsRepositories(config);
  return config;
}

module.exports = createRunOncePlugin(withOlaMaps, 'rn-ola-maps', '1.0.0');
