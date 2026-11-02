const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withFoldableConfigChanges(config) {
  return withAndroidManifest(config, (cfg) => {
    const activities = cfg.modResults.manifest.application?.[0]?.activity || [];
    const main = activities.find((activity) => activity.$['android:name'] === '.MainActivity');
    if (!main) throw new Error('MainActivity missing from AndroidManifest.xml');
    const changes = new Set((main.$['android:configChanges'] || '').split('|').filter(Boolean));
    changes.add('smallestScreenSize');
    changes.add('density');
    main.$['android:configChanges'] = [...changes].join('|');
    return cfg;
  });
};
