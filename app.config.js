// Configuration de l'appli : app.json + ce qu'il faut pour la vraie version (appels natifs, sonnerie du système).
// Expo Go ignore les modules natifs ; la vraie version (fichier APK / App Store) les embarque.
const fs = require('fs');

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE || '';   // construction par Expo (EAS) : « dev » ou « apk »
  const native = !!profile;
  // Firebase (notifications Android) : fichier google-services.json donné à Expo (variable GOOGLE_SERVICES_JSON de type fichier), jamais dans ce dépôt public
  const googleServices = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);
  return {
    ...config,
    version: '0.2.0',
    ios: { ...config.ios, infoPlist: { ...config.ios.infoPlist, UIBackgroundModes: ['audio', 'voip'] } },
    android: {
      ...config.android,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
      permissions: [...new Set([...(config.android.permissions || []), 'android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.BLUETOOTH_CONNECT', 'android.permission.MANAGE_OWN_CALLS', 'android.permission.POST_NOTIFICATIONS', 'android.permission.USE_FULL_SCREEN_INTENT'])],
    },
    plugins: [
      ...config.plugins,
      ['expo-callkit-telecom', { incomingCallTimeout: 30, outgoingCallTimeout: 60, fulfillAnswerCallTimeout: 15, includesCallsInRecents: true,
        microphonePermission: 'Parler pendant tes appels.' }],
      'expo-notifications',
      ['expo-build-properties', { ios: { deploymentTarget: '16.4' }, android: { minSdkVersion: 26 } }],
    ],
    // Vraie version : pas de mise à jour à distance du code (elle doit correspondre à ses modules natifs) ; Expo Go : comme avant
    ...(native ? { updates: { ...config.updates, enabled: false } } : {}),
    extra: { ...config.extra, apnsEnv: profile === 'dev' ? 'development' : 'production', fcm: !!googleServices },
  };
};
