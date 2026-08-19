#!/usr/bin/env node

/**
 * Build the Node addon the desktop shell loads.
 *
 * `electron-builder` packages whatever `crates/sourdaw-native/*.node` exists;
 * a missing artifact packages silently and ships a DMG with no native
 * surface. This script makes the artifact, and its non-zero exit is the
 * loud failure the packaging chain relies on.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function cdylibFileName(platform: NodeJS.Platform): string {
    if (platform === 'darwin') {
        return 'libsourdaw_native.dylib';
    }
    if (platform === 'win32') {
        return 'sourdaw_native.dll';
    }
    return 'libsourdaw_native.so';
}

function main(): number {
    const repoRoot = process.cwd();
    const build = spawnSync(
        'cargo',
        ['build', '--release', '--package', 'sourdaw-native', '--features', 'napi-addon'],
        {
            cwd: repoRoot,
            stdio: 'inherit',
        }
    );
    if (build.error !== undefined) {
        console.error(`cargo failed to start: ${build.error.message}`);
        return 1;
    }
    if (build.status !== 0) {
        console.error('cargo build --package sourdaw-native --features napi-addon failed');
        return 1;
    }

    const artifact = join(repoRoot, 'target', 'release', cdylibFileName(process.platform));
    if (!existsSync(artifact)) {
        console.error(`the cargo build produced no cdylib at ${artifact}`);
        return 1;
    }
    const destination = join(repoRoot, 'crates', 'sourdaw-native', 'sourdaw-native.node');
    copyFileSync(artifact, destination);
    console.log(`native addon at ${destination}`);
    return 0;
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
