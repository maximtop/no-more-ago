/**
 * @file Builds and validates a universal Xcode archive for the Mac App Store.
 */

import { rmSync } from 'node:fs';
import path from 'node:path';

import { validateSafariArtifact } from './artifact.ts';
import {
    ROOT_PATH,
    SAFARI_APP_NAME,
    SAFARI_ARCHIVE_PATH,
    SAFARI_OUTPUT_PATH,
    SAFARI_PROJECT_PATH,
    SAFARI_SCHEME,
    parseUnsignedOption,
    readAppleTeamIdentifier,
    readBuildNumber,
    readPackageVersion,
    run,
} from './config.ts';
import { prepareXcodeResources } from './xcode-resources.ts';

const unsigned = parseUnsignedOption();
const buildNumber = readBuildNumber(unsigned ? '1' : undefined);
if (buildNumber === undefined) {
    throw new Error('SAFARI_BUILD_NUMBER is required for a signed archive');
}

// A fresh derived-data directory keeps resources removed since an earlier build out of the archive.
const derivedDataPath = path.join(SAFARI_OUTPUT_PATH, 'xcode-store');
rmSync(SAFARI_ARCHIVE_PATH, { recursive: true, force: true });
rmSync(derivedDataPath, { recursive: true, force: true });
run('pnpm', ['release', 'safari']);
prepareXcodeResources(path.join(ROOT_PATH, 'dist/release/safari'));
run('xcodebuild', [
    '-quiet',
    '-project',
    SAFARI_PROJECT_PATH,
    '-scheme',
    SAFARI_SCHEME,
    '-configuration',
    'Release',
    '-destination',
    'generic/platform=macOS',
    '-derivedDataPath',
    derivedDataPath,
    '-archivePath',
    SAFARI_ARCHIVE_PATH,
    `MARKETING_VERSION=${readPackageVersion()}`,
    `CURRENT_PROJECT_VERSION=${buildNumber}`,
    `DEVELOPMENT_TEAM=${readAppleTeamIdentifier()}`,
    'ARCHS=arm64 x86_64',
    'ONLY_ACTIVE_ARCH=NO',
    ...(unsigned
        ? ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO']
        : ['CODE_SIGN_STYLE=Manual', 'CODE_SIGN_IDENTITY=Apple Distribution']),
    'archive',
]);

validateSafariArtifact({
    appPath: path.join(SAFARI_ARCHIVE_PATH, 'Products/Applications', SAFARI_APP_NAME),
    buildNumber,
    universal: true,
    signed: !unsigned,
    appStore: !unsigned,
});
process.stdout.write(`${unsigned ? 'Unsigned' : 'Signed'} App Store archive validated: ${SAFARI_ARCHIVE_PATH}\n`);
