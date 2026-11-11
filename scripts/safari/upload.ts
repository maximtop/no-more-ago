/**
 * @file Exports the validated signed archive and uploads it to App Store Connect.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { validateSafariArtifact } from './artifact.ts';
import {
    SAFARI_APP_BUNDLE_IDENTIFIER,
    SAFARI_APP_NAME,
    SAFARI_APP_STORE_APP_PROFILE,
    SAFARI_APP_STORE_EXTENSION_PROFILE,
    SAFARI_ARCHIVE_PATH,
    SAFARI_EXTENSION_BUNDLE_IDENTIFIER,
    SAFARI_OUTPUT_PATH,
    appStoreConnectAuthenticationArgs,
    readAppleTeamIdentifier,
    readBuildNumber,
    run,
} from './config.ts';

validateSafariArtifact({
    appPath: path.join(SAFARI_ARCHIVE_PATH, 'Products/Applications', SAFARI_APP_NAME),
    buildNumber: readBuildNumber(),
    universal: true,
    signed: true,
    appStore: true,
});

const exportPath = path.join(SAFARI_OUTPUT_PATH, 'store/upload');
const exportOptionsPath = path.join(SAFARI_OUTPUT_PATH, 'store/ExportOptions.plist');
const exportOptions = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>destination</key>
    <string>upload</string>
    <key>manageAppVersionAndBuildNumber</key>
    <false/>
    <key>method</key>
    <string>app-store-connect</string>
    <key>signingStyle</key>
    <string>manual</string>
    <key>signingCertificate</key>
    <string>Apple Distribution</string>
    <key>installerSigningCertificate</key>
    <string>3rd Party Mac Developer Installer</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>${SAFARI_APP_BUNDLE_IDENTIFIER}</key>
        <string>${SAFARI_APP_STORE_APP_PROFILE}</string>
        <key>${SAFARI_EXTENSION_BUNDLE_IDENTIFIER}</key>
        <string>${SAFARI_APP_STORE_EXTENSION_PROFILE}</string>
    </dict>
    <key>teamID</key>
    <string>${readAppleTeamIdentifier()}</string>
</dict>
</plist>
`;

rmSync(exportPath, { recursive: true, force: true });
mkdirSync(path.dirname(exportOptionsPath), { recursive: true });
writeFileSync(exportOptionsPath, exportOptions, { mode: 0o600 });
run('xcodebuild', [
    '-exportArchive',
    '-archivePath',
    SAFARI_ARCHIVE_PATH,
    '-exportPath',
    exportPath,
    '-exportOptionsPlist',
    exportOptionsPath,
    ...appStoreConnectAuthenticationArgs(),
]);
process.stdout.write('Safari build uploaded to App Store Connect for processing.\n');
