#!/usr/bin/env node

/**
 * Build and install the `sourdaw-harness-tone` CLAP test plugin the
 * packaged-app latency harness (#3070) loads through the real plugin
 * scanner and host.
 *
 * The scanner recognises CLAP only as a plain file today (#3469), so this
 * ships a flat `.clap` file rather than a bundle directory. It lands under a
 * dedicated `Sourdaw Harness` subfolder of the platform's per-user CLAP
 * root, keeping the harness plugin visibly separate from a developer's own
 * plugins in that same root.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export function cdylibFileName(platform: NodeJS.Platform): string {
    if (platform === 'darwin') {
        return 'libsourdaw_harness_tone.dylib';
    }
    if (platform === 'win32') {
        return 'sourdaw_harness_tone.dll';
    }
    return 'libsourdaw_harness_tone.so';
}

/**
 * The per-user CLAP root's `Sourdaw Harness Tone.clap` destination for
 * `platform`, matching `crates/sourdaw-native/src/host/plugin_scan_policy.rs`'s
 * `default_plugin_scan_roots`: darwin and linux root under `home`; win32
 * roots under the machine-wide Common Files CLAP folder, so `home` there is
 * that folder's path (typically `%COMMONPROGRAMFILES%\CLAP`) rather than a
 * user's home directory.
 *
 * The win32 branch joins with `path.win32` rather than the platform-default
 * `join`, so the backslash-separated result this function returns is correct
 * even under test, where the host running it is never actually Windows.
 */
export function harnessPluginDestination(platform: NodeJS.Platform, home: string): string {
    if (platform === 'darwin') {
        return join(home, 'Library', 'Audio', 'Plug-Ins', 'CLAP', 'Sourdaw Harness', 'Sourdaw Harness Tone.clap');
    }
    if (platform === 'win32') {
        return win32.join(home, 'CLAP', 'Sourdaw Harness', 'Sourdaw Harness Tone.clap');
    }
    return join(home, '.clap', 'Sourdaw Harness', 'Sourdaw Harness Tone.clap');
}

function platformHome(platform: NodeJS.Platform): string {
    if (platform === 'win32') {
        return process.env.COMMONPROGRAMFILES ?? 'C:\\Program Files\\Common Files';
    }
    return homedir();
}

function main(): number {
    const repoRoot = process.cwd();
    const build = spawnSync('cargo', ['build', '--release', '--package', 'sourdaw-harness-tone'], {
        cwd: repoRoot,
        stdio: 'inherit',
    });
    if (build.error !== undefined) {
        console.error(`cargo failed to start: ${build.error.message}`);
        return 1;
    }
    if (build.status !== 0) {
        console.error('cargo build --package sourdaw-harness-tone failed');
        return 1;
    }

    const targetDir = process.env.CARGO_TARGET_DIR ?? join(repoRoot, 'target');
    const artifact = join(targetDir, 'release', cdylibFileName(process.platform));
    if (!existsSync(artifact)) {
        console.error(`the cargo build produced no cdylib at ${artifact}`);
        return 1;
    }

    const destination = harnessPluginDestination(process.platform, platformHome(process.platform));
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(artifact, destination);
    console.log(`harness plugin installed at ${destination}`);
    return 0;
}

// `realpathSync`, because the ESM loader realpaths `import.meta.url` while
// `argv[1]` keeps any symlink; a plain `resolve` comparison would silently
// skip `main()` — and exit 0 — from a symlinked checkout.
const invokedPath = process.argv[1] === undefined ? '' : realpathSync(resolve(process.argv[1]));
if (invokedPath === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
