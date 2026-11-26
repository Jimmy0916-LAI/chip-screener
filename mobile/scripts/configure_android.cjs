'use strict';

/**
 * 在 `npx cap add android` / `npx cap sync android` 之後執行，
 * 冪等套用 ChipScreener Android 安全設定、minSdk 30 (Android 11)、ChipNative 外掛與 Release 簽章設定。
 */

const fs = require('node:fs');
const path = require('node:path');

const MOBILE_DIR = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(MOBILE_DIR, 'android');
const NATIVE_DIR = path.join(MOBILE_DIR, 'native');

if (!fs.existsSync(ANDROID_DIR)) {
  console.error('找不到 mobile/android 目錄，請先執行 npx cap add android');
  process.exit(1);
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('Copied:', path.relative(MOBILE_DIR, dst));
}

// 1. 複製 Java 原生外掛與 MainActivity
const javaPkgDir = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java', 'tw', 'chipscreener', 'mobile');
copyFile(path.join(NATIVE_DIR, 'ChipNativePlugin.java'), path.join(javaPkgDir, 'ChipNativePlugin.java'));
copyFile(path.join(NATIVE_DIR, 'MainActivity.java'), path.join(javaPkgDir, 'MainActivity.java'));

// 2. 複製安全 XML 設定與 ProGuard 規則
const resXmlDir = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res', 'xml');
copyFile(path.join(NATIVE_DIR, 'network_security_config.xml'), path.join(resXmlDir, 'network_security_config.xml'));
copyFile(path.join(NATIVE_DIR, 'data_extraction_rules.xml'), path.join(resXmlDir, 'data_extraction_rules.xml'));
copyFile(path.join(NATIVE_DIR, 'backup_rules.xml'), path.join(resXmlDir, 'backup_rules.xml'));
copyFile(path.join(NATIVE_DIR, 'proguard-rules.pro'), path.join(ANDROID_DIR, 'app', 'proguard-rules.pro'));

// 3. 設定 minSdkVersion = 30 (Android 11)
const varsPath = path.join(ANDROID_DIR, 'variables.gradle');
if (fs.existsSync(varsPath)) {
  let vars = fs.readFileSync(varsPath, 'utf8');
  vars = vars.replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 30');
  fs.writeFileSync(varsPath, vars, 'utf8');
  console.log('Patched variables.gradle: minSdkVersion = 30');
}

// 4. 修補 AndroidManifest.xml（禁止明文、禁止雲端備份金庫、通知權限）
const manifestPath = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');

const permissions = [
  'android.permission.INTERNET',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.SCHEDULE_EXACT_ALARM'
];

for (const perm of permissions) {
  if (!manifest.includes(perm)) {
    manifest = manifest.replace(
      '<application',
      `    <uses-permission android:name="${perm}" />\n\n    <application`
    );
  }
}

manifest = manifest.replace(/android:allowBackup="true"/g, 'android:allowBackup="false"');
if (!manifest.includes('android:allowBackup=')) {
  manifest = manifest.replace('<application', '<application\n        android:allowBackup="false"');
}
if (!manifest.includes('android:networkSecurityConfig=')) {
  manifest = manifest.replace(
    '<application',
    '<application\n        android:networkSecurityConfig="@xml/network_security_config"'
  );
}
if (!manifest.includes('android:dataExtractionRules=')) {
  manifest = manifest.replace(
    '<application',
    '<application\n        android:dataExtractionRules="@xml/data_extraction_rules"\n        android:fullBackupContent="@xml/backup_rules"'
  );
}
if (!manifest.includes('android:usesCleartextTraffic=')) {
  manifest = manifest.replace(
    '<application',
    '<application\n        android:usesCleartextTraffic="false"'
  );
}

fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log('Patched AndroidManifest.xml');

// 5. 修補 app/build.gradle：開啟 R8 壓縮混淆 + 環境變數 Release 簽章
const appGradlePath = path.join(ANDROID_DIR, 'app', 'build.gradle');
let gradle = fs.readFileSync(appGradlePath, 'utf8');

if (!gradle.includes('CHIP_RELEASE_SIGNING_CONFIG')) {
  const signingBlock = `
    // CHIP_RELEASE_SIGNING_CONFIG
    signingConfigs {
        release {
            def ksFile = System.getenv("KEYSTORE_FILE")
            if (ksFile != null && !ksFile.isEmpty()) {
                storeFile file(ksFile)
                storePassword System.getenv("KEYSTORE_PASSWORD")
                keyAlias System.getenv("KEY_ALIAS")
                keyPassword System.getenv("KEY_PASSWORD")
            }
        }
    }
`;
  gradle = gradle.replace(/buildTypes\s*\{/, signingBlock + '\n    buildTypes {');
}

gradle = gradle.replace(
  /release\s*\{[\s\S]*?\n\s*\}/,
  `release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
            def ksFile = System.getenv("KEYSTORE_FILE")
            if (ksFile != null && !ksFile.isEmpty()) {
                signingConfig signingConfigs.release
            }
        }`
);

fs.writeFileSync(appGradlePath, gradle, 'utf8');
console.log('Patched app/build.gradle (R8 + Release signing)');
