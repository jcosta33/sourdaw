#!/usr/bin/env node

/**
 * Build the Node addon and the plugin-scan leaf helper the desktop shell
 * ships.
 *
 * `electron-builder` packages whatever `crates/sourdaw-native/*.node` exists,
 * and separately whatever `sourdaw-plugin-scan-helper[.exe]` exists there; a
 * missing artifact packages silently and ships a DMG with no native surface,
 * or one whose plugin scan can never complete. This script makes both
 * artifacts, and its non-zero exit is the loud failure the packaging chain
 * relies on.
 *
 * Both come from the `sourdaw-native` package: the addon is its `cdylib`
 * (`napi-addon` feature on), and the helper is its `[[bin]]`
 * (`src/bin/sourdaw-plugin-scan-helper.rs`) — see that file's doc comment
 * for why the two need different LTO settings and therefore two separate
 * `cargo build` invocations rather than one. Both artifacts land beside each
 * other in `crates/sourdaw-native/`, which is what `electron-builder.yml`
 * and `resolveScanHelperPath()` in `electron/native.ts` both expect.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function cdylibFileName(platform: NodeJS.Platform): string {
    if (platform === 'darwin') {
        return 'libsourdaw_native.dylib';
    }
    if (platform === 'win32') {
        return 'sourdaw_native.dll';
    }
    if (platform === 'linux') {
        return 'libsourdaw_native.so';
    }
    throw new Error(`unsupported native platform: ${platform}`);
}

export function scanHelperFileName(platform: NodeJS.Platform): string {
    if (platform === 'win32') {
        return 'sourdaw-plugin-scan-helper.exe';
    }
    if (platform === 'darwin' || platform === 'linux') {
        return 'sourdaw-plugin-scan-helper';
    }
    throw new Error(`unsupported native platform: ${platform}`);
}

type CargoResult = { status: number | null; error?: Error; stdout?: string | null };
type CargoRunner = (
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; captureOutput: boolean }
) => CargoResult;

const runCargoProcess: CargoRunner = (args, { cwd, env, captureOutput }) =>
    spawnSync('cargo', args, { cwd, env, encoding: 'utf8', stdio: captureOutput ? 'pipe' : 'inherit' });

function nativeCargoHost(repoRoot: string, env: NodeJS.ProcessEnv, runCargo: CargoRunner): string {
    const version = runCargo(['-Vv'], { cwd: repoRoot, env, captureOutput: true });
    if (version.error !== undefined) {
        throw new Error(`cargo host query failed to start: ${version.error.message}`);
    }
    if (version.status !== 0) {
        throw new Error('cargo -Vv host query failed');
    }
    const hostLines = (version.stdout ?? '').split(/\r?\n/).filter((line) => line.startsWith('host:'));
    if (hostLines.length !== 1 || !/^host: [a-z0-9_]+(?:-[a-z0-9_]+){2,}$/.test(hostLines[0])) {
        throw new Error('cargo -Vv must report exactly one well-formed native host');
    }
    return hostLines[0].slice('host: '.length);
}

function nativePlatform(host: string): NodeJS.Platform {
    if (/^[a-z0-9_]+-apple-darwin$/.test(host)) {
        return 'darwin';
    }
    if (/^[a-z0-9_]+-[a-z0-9_]+-linux-[a-z0-9_]+$/.test(host)) {
        return 'linux';
    }
    if (/^[a-z0-9_]+-[a-z0-9_]+-windows-[a-z0-9_]+$/.test(host)) {
        return 'win32';
    }
    throw new Error(`unsupported native Cargo host: ${host}`);
}

function cargoBuild(
    args: readonly string[],
    repoRoot: string,
    failureMessage: string,
    env: NodeJS.ProcessEnv,
    runCargo: CargoRunner
): number | undefined {
    const build = runCargo(args, { cwd: repoRoot, env, captureOutput: false });
    if (build.error !== undefined) {
        console.error(`cargo failed to start: ${build.error.message}`);
        return 1;
    }
    if (build.status !== 0) {
        console.error(failureMessage);
        return 1;
    }
    return undefined;
}

export function runNativeAddonBuild({
    repoRoot = process.cwd(),
    env = process.env,
    runCargo = runCargoProcess,
}: { repoRoot?: string; env?: NodeJS.ProcessEnv; runCargo?: CargoRunner } = {}): number {
    try {
        return buildNativeAddon(resolve(repoRoot), env, runCargo);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

function buildNativeAddon(repoRoot: string, env: NodeJS.ProcessEnv, runCargo: CargoRunner): number {
    const host = nativeCargoHost(repoRoot, env, runCargo);
    const platform = nativePlatform(host);
    if (
        env.CARGO_BUILD_TARGET !== undefined &&
        env.CARGO_BUILD_TARGET !== host &&
        env.CARGO_BUILD_TARGET !== 'host-tuple'
    ) {
        throw new Error(`CARGO_BUILD_TARGET must be the native Cargo host ${host} or host-tuple`);
    }
    const configuredTargetDir = env.CARGO_TARGET_DIR ?? join(repoRoot, 'target');
    if (configuredTargetDir.trim() === '' || /[\0\r\n]/.test(configuredTargetDir)) {
        throw new Error('CARGO_TARGET_DIR must be a nonempty valid output directory');
    }
    const targetDir = resolve(repoRoot, configuredTargetDir);
    if (existsSync(targetDir) && !statSync(targetDir).isDirectory()) {
        throw new Error('CARGO_TARGET_DIR must name an output directory');
    }

    // `--lib`: the addon build must never also build the `[[bin]]` declared
    // in this same package, because that bin cannot share the workspace's
    // `lto = true` release profile (see the bin's own doc comment).
    const addonFailure = cargoBuild(
        [
            'build',
            '--release',
            '--lib',
            '--package',
            'sourdaw-native',
            '--features',
            'napi-addon',
            '--target',
            host,
            '--target-dir',
            targetDir,
        ],
        repoRoot,
        'cargo build --lib --package sourdaw-native --features napi-addon failed',
        env,
        runCargo
    );
    if (addonFailure !== undefined) {
        return addonFailure;
    }

    const addonArtifact = join(targetDir, host, 'release', cdylibFileName(platform));
    if (!existsSync(addonArtifact)) {
        console.error(`the cargo build produced no cdylib at ${addonArtifact}`);
        return 1;
    }
    const addonDestination = join(repoRoot, 'crates', 'sourdaw-native', 'sourdaw-native.node');
    copyFileSync(addonArtifact, addonDestination);
    console.log(`native addon at ${addonDestination}`);

    // `.cargo/config.toml`'s global `-Cembed-bitcode=no` is incompatible with
    // `-C lto` for a final-linked executable, so this bin cannot share the
    // workspace's `lto = true` release profile the addon just built under.
    // `CARGO_PROFILE_RELEASE_LTO=false` is Cargo's documented per-invocation
    // profile-key override, and building it under its own `--target-dir`
    // keeps this LTO setting from invalidating the addon's `release` cache
    // (or vice versa) — without editing the workspace `Cargo.toml`,
    // `Cargo.lock`, or the wasm packages' source-hash closure over it.
    const helperTargetDir = join(targetDir, 'scan-helper');
    const helperFailure = cargoBuild(
        [
            'build',
            '--release',
            '--package',
            'sourdaw-native',
            '--bin',
            'sourdaw-plugin-scan-helper',
            '--target',
            host,
            '--target-dir',
            helperTargetDir,
        ],
        repoRoot,
        'cargo build --package sourdaw-native --bin sourdaw-plugin-scan-helper failed',
        { ...env, CARGO_PROFILE_RELEASE_LTO: 'false' },
        runCargo
    );
    if (helperFailure !== undefined) {
        return helperFailure;
    }

    const helperArtifact = join(helperTargetDir, host, 'release', scanHelperFileName(platform));
    if (!existsSync(helperArtifact)) {
        console.error(`the cargo build produced no scan helper at ${helperArtifact}`);
        return 1;
    }
    const helperDestination = join(repoRoot, 'crates', 'sourdaw-native', scanHelperFileName(platform));
    copyFileSync(helperArtifact, helperDestination);
    // `copyFileSync` does not guarantee the executable bit survives; the scan
    // policy spawns this file as a process, so it must carry the source
    // artifact's own mode rather than whatever the copy left it with.
    chmodSync(helperDestination, statSync(helperArtifact).mode);
    console.log(`plugin scan helper at ${helperDestination}`);

    return 0;
}

// `realpathSync`, because the ESM loader realpaths `import.meta.url` while
// `argv[1]` keeps any symlink; a plain `resolve` comparison would silently
// skip the build — and exit 0 — from a symlinked checkout.
const invokedPath = process.argv[1] === undefined ? '' : realpathSync(resolve(process.argv[1]));
if (invokedPath === fileURLToPath(import.meta.url)) {
    process.exit(runNativeAddonBuild());
}
