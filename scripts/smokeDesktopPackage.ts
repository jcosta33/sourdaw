#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, toNamespacedPath } from 'node:path';

import { type Page } from 'playwright';

import { type SourdawBridge } from '../electron/channels.ts';

import { type Diagnostics, emptyDiagnostics, printDiagnostics } from './desktopLatencyDiagnostics.ts';
import { waitForVisibleLaunchScreen } from './desktopLatencyLaunch.ts';
import { harnessPluginDestination } from './installHarnessPlugin.ts';
import { launchPackagedApp, step } from './packagedAppSession.ts';

const FORMATS = {
    dmg: { extension: '.dmg', platform: 'darwin', arch: 'arm64', method: 'mount read-only and launch Sourdaw.app' },
    zip: { extension: '.zip', platform: 'darwin', arch: 'arm64', method: 'extract with ditto and launch Sourdaw.app' },
    nsis: {
        extension: '.exe',
        platform: 'win32',
        arch: 'x64',
        method: 'NSIS silent per-user install and launch Sourdaw.exe',
    },
    appimage: {
        extension: '.AppImage',
        platform: 'linux',
        arch: 'x64',
        method: 'AppImage --appimage-extract, then AppRun under Xvfb in CI',
    },
} as const;
type Format = keyof typeof FORMATS;
type DesktopWindow = Window & { readonly sourdaw?: SourdawBridge };
type PackageArtifact = { name: string; sha256: string };
type ReceiptStatus = 'passed' | 'failed';

const STARTUP_TIMEOUT_MS = 45_000;
const SCAN_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 300_000;
const RENDERER_URL_PREFIX = 'app://sourdaw/';
const SAMPLE = 'levain/bassoon/PSBassoon_A1_v1_1.wav';
const SAMPLE_URL = `${RENDERER_URL_PREFIX}samples/${SAMPLE}`;
const PLUGIN_DESCRIPTOR = 'com.sourdaw.harness-tone';

function parseFormat(value: string | undefined): Format {
    switch (value) {
        case 'dmg':
        case 'zip':
        case 'nsis':
        case 'appimage':
            return value;
        case undefined:
        default:
            throw new Error('Expected a package format: dmg, zip, nsis, or appimage');
    }
}

async function sha256(path: string): Promise<string> {
    const hash = createHash('sha256');
    const bytes: AsyncIterable<unknown> = createReadStream(path);
    for await (const chunk of bytes) {
        assert(Buffer.isBuffer(chunk));
        hash.update(chunk);
    }
    return hash.digest('hex');
}

const macExecutable = (directory: string): string => join(directory, 'Sourdaw.app', 'Contents', 'MacOS', 'Sourdaw');

async function withInstalledPackage(
    format: Format,
    artifact: string,
    scratch: string,
    verify: (binary: string) => Promise<void>
): Promise<void> {
    const installed = join(scratch, 'installed');
    const options = { cwd: scratch, stdio: 'inherit' as const, timeout: INSTALL_TIMEOUT_MS };
    switch (format) {
        case 'dmg':
            await mkdir(installed);
            execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', installed, artifact], options);
            try {
                await verify(macExecutable(installed));
            } finally {
                execFileSync('hdiutil', ['detach', installed], options);
            }
            break;
        case 'zip':
            execFileSync('ditto', ['-x', '-k', artifact, installed], options);
            await verify(macExecutable(installed));
            break;
        case 'nsis': {
            // NSIS reads /D from the raw command line. Quote the executable and leave /D unquoted.
            const installer = spawnSync(artifact, ['/S', `/D=${installed}`], {
                ...options,
                argv0: `"${artifact}"`,
                windowsVerbatimArguments: true,
            });
            if (installer.error !== undefined) {
                throw installer.error;
            }
            assert.equal(installer.status, 0, 'the NSIS silent install failed');
            await verify(join(installed, 'Sourdaw.exe'));
            break;
        }
        case 'appimage':
            await chmod(artifact, 0o755);
            // The type-2 runtime extracts its own payload. Starting AppRun directly keeps Electron
            // as the process the shared session owns and can quit; FUSE is not required on the runner.
            execFileSync(artifact, ['--appimage-extract'], { ...options, stdio: ['ignore', 'ignore', 'inherit'] });
            await verify(join(scratch, 'squashfs-root', 'AppRun'));
            break;
    }
}

async function withFreshHarnessPlugin(verify: (pluginPath: string) => Promise<void>): Promise<void> {
    const source = await realpath(harnessPluginDestination(process.platform, homedir(), process.env.LOCALAPPDATA));
    // A fresh path under the authorized root forces a real scan even if another format populated the registry.
    const root = await mkdtemp(join(dirname(source), 'package-smoke-'));
    try {
        const path = join(root, basename(source));
        await copyFile(source, path);
        await verify(path);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

function findHarnessPluginPath(result: unknown): string {
    assert(
        result !== null && typeof result === 'object' && 'plugins' in result && Array.isArray(result.plugins),
        'scan_plugins returned no plugin list'
    );
    const plugins: unknown[] = result.plugins;
    const plugin = plugins.find(
        (entry): entry is Record<'descriptor_id', unknown> =>
            entry !== null &&
            typeof entry === 'object' &&
            'descriptor_id' in entry &&
            entry.descriptor_id === PLUGIN_DESCRIPTOR
    );
    assert(plugin !== undefined, `scan_plugins did not return ${PLUGIN_DESCRIPTOR}: ${JSON.stringify(result)}`);
    assert('format' in plugin && plugin.format === 'clap', 'scan_plugins did not identify the fixture as CLAP');
    assert(
        'path' in plugin && typeof plugin.path === 'string',
        'scan_plugins did not return a path for the harness plugin'
    );
    return plugin.path;
}

async function verifyBundledSample(page: Page): Promise<void> {
    const { sampleUrl, signature } = await step('read a packaged WAV via app://', () =>
        page.evaluate(async (sample) => {
            const bridge = (window as DesktopWindow).sourdaw;
            if (bridge === undefined) {
                throw new Error('Sourdaw desktop bridge is not available');
            }
            const sampleUrl = `${await bridge.paths.samplesBase()}/${sample}`;
            const response = await fetch(sampleUrl);
            if (!response.ok) {
                throw new Error(`sample fetch returned HTTP ${response.status}: ${sampleUrl}`);
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            return { sampleUrl, signature: String.fromCharCode(...bytes.slice(0, 4), ...bytes.slice(8, 12)) };
        }, SAMPLE)
    );
    assert.equal(sampleUrl, SAMPLE_URL);
    assert.equal(signature, 'RIFFWAVE');
}

async function verifyNativePluginScan(page: Page, pluginPath: string): Promise<void> {
    const scanRoot = dirname(pluginPath);
    const authorized = await step('authorize the fixture folder through native IPC', () =>
        page.evaluate((root) => {
            const bridge = (window as DesktopWindow).sourdaw;
            if (bridge === undefined) {
                throw new Error('Sourdaw desktop bridge is not available');
            }
            return bridge.invoke('is_scan_path_authorized', [root]);
        }, scanRoot)
    );
    assert.equal(authorized, true, `the native addon did not authorize ${scanRoot}`);
    const scan = await step(
        'scan the real CLAP fixture with the packaged helper',
        () =>
            page.evaluate((root) => {
                const bridge = (window as DesktopWindow).sourdaw;
                if (bridge === undefined) {
                    throw new Error('Sourdaw desktop bridge is not available');
                }
                return bridge.invoke('scan_plugins', [[root], false]);
            }, scanRoot),
        SCAN_TIMEOUT_MS
    );
    const actual = findHarnessPluginPath(scan);
    const expected = await realpath(pluginPath);
    // Rust canonicalization returns a verbatim namespace path on Windows.
    assert(
        actual === expected || actual === toNamespacedPath(expected),
        'scan_plugins must return the installed fixture'
    );
}

async function verifyInstalledApp(
    binary: string,
    scratch: string,
    pluginPath: string,
    diagnostics: Diagnostics
): Promise<void> {
    await access(binary, constants.X_OK);
    const app = await launchPackagedApp(binary, join(scratch, 'profile'), diagnostics, scratch);
    try {
        await waitForVisibleLaunchScreen(app.page, STARTUP_TIMEOUT_MS);
        assert(app.page.url().startsWith(RENDERER_URL_PREFIX), 'expected the packaged app:// renderer');
        await verifyBundledSample(app.page);
        await verifyNativePluginScan(app.page, pluginPath);
    } finally {
        try {
            await app.quit();
        } finally {
            process.stdout.write(`\n--- packaged app output ---\n${app.output().trim()}\n`);
        }
    }
}

function packageReceipt(head: string, format: Format, status: ReceiptStatus, artifact: PackageArtifact | undefined) {
    const receipt = {
        head,
        platform: process.platform,
        arch: process.arch,
        format,
        launchMethod: FORMATS[format].method,
        status,
        artifact,
    };
    if (status === 'failed') {
        return receipt;
    }

    // Only locally defined outcomes reach the receipt. Raw diagnostics stay in the CI log.
    return {
        ...receipt,
        renderer: 'launch-screen',
        rendererUrlPrefix: RENDERER_URL_PREFIX,
        sample: SAMPLE_URL,
        nativeIpc: 'is_scan_path_authorized returned true',
        plugin: { descriptorId: PLUGIN_DESCRIPTOR, format: 'clap', matchesInstalledFixture: true },
    };
}

async function main(): Promise<void> {
    const format = parseFormat(process.argv[2]);
    const receipts = process.argv[3];
    assert(receipts !== undefined, 'Pass a directory for the package smoke receipts');
    const target = FORMATS[format];
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.match(head, /^[0-9a-f]{40}$/u);
    const diagnostics = emptyDiagnostics();
    let status: ReceiptStatus = 'failed';
    let artifact: PackageArtifact | undefined;
    try {
        assert.equal(head, process.env.SOURDAW_PACKAGE_HEAD ?? head, 'checkout differs from the requested head');
        assert.equal(process.platform, target.platform);
        assert.equal(process.arch, target.arch);
        const output = resolve('release/desktop');
        const names = (await readdir(output)).filter((name) => name.endsWith(target.extension));
        assert.equal(
            names.length,
            1,
            `Expected exactly one ${target.extension} package in ${output}: ${names.join(', ')}`
        );
        const name = names[0];
        assert(name !== undefined);
        const scratch = await mkdtemp(join(tmpdir(), 'sourdaw-package-'));
        try {
            const copy = join(scratch, name);
            await copyFile(join(output, name), copy);
            artifact = { name, sha256: await sha256(copy) };
            await withFreshHarnessPlugin((pluginPath) =>
                withInstalledPackage(format, copy, scratch, (binary) =>
                    verifyInstalledApp(binary, scratch, pluginPath, diagnostics)
                )
            );
        } finally {
            await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
        }
        status = 'passed';
    } finally {
        printDiagnostics(diagnostics);
        const receipt = packageReceipt(head, format, status, artifact);
        await mkdir(receipts, { recursive: true });
        await writeFile(join(receipts, `${format}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
        console.log(`${format}: ${status} ${JSON.stringify(artifact)}`);
    }
}

await main();
