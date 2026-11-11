/**
 * @file Builds and validates the locally installable Safari containing app.
 */

import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';

import { validateSafariArtifact } from './artifact.ts';
import {
    ROOT_PATH,
    SAFARI_APP_NAME,
    SAFARI_EXTENSION_RELATIVE_PATH,
    SAFARI_OUTPUT_PATH,
    SAFARI_PROJECT_PATH,
    SAFARI_SCHEME,
    readPackageVersion,
    run,
} from './config.ts';
import { prepareXcodeResources } from './xcode-resources.ts';

const derivedDataPath = path.join(SAFARI_OUTPUT_PATH, 'xcode');
const appPath = path.join(SAFARI_OUTPUT_PATH, 'dev', SAFARI_APP_NAME);
const projectRoot = path.dirname(SAFARI_PROJECT_PATH);

rmSync(path.dirname(appPath), { recursive: true, force: true });
rmSync(derivedDataPath, { recursive: true, force: true });

run('pnpm', ['dev', 'safari']);
prepareXcodeResources(path.join(ROOT_PATH, 'dist/dev/safari'));
run('xcodebuild', [
    '-quiet',
    '-project',
    SAFARI_PROJECT_PATH,
    '-scheme',
    SAFARI_SCHEME,
    '-configuration',
    'Debug',
    '-derivedDataPath',
    derivedDataPath,
    `MARKETING_VERSION=${readPackageVersion()}`,
    'CODE_SIGNING_ALLOWED=NO',
    'build',
]);
cpSync(path.join(derivedDataPath, 'Build/Products/Debug', SAFARI_APP_NAME), appPath, { recursive: true });

// Ad-hoc signatures apply the sandbox entitlements Safari requires to load a local build.
for (const [target, entitlements] of [
    [path.join(appPath, SAFARI_EXTENSION_RELATIVE_PATH), 'No More Ago Extension/No More Ago Extension.entitlements'],
    [appPath, 'No More Ago/No More Ago.entitlements'],
] as const) {
    run('codesign', [
        '--force',
        '--sign',
        '-',
        '--timestamp=none',
        '--entitlements',
        path.join(projectRoot, entitlements),
        target,
    ]);
}

validateSafariArtifact({
    appPath,
    universal: false,
    signed: true,
    appStore: false,
});
process.stdout.write(`Safari app built and validated: ${appPath}\n`);
