/**
 * The scan worker's contract with the Rust policy (REQ-007).
 *
 * Everything here is a name or a shape that exists twice — once in TypeScript,
 * once in `crates/sourdaw-native/src/host/plugin_scan_worker.rs` — and that
 * fails silently when the two drift: the policy would fall back to re-executing
 * the Electron binary, every plugin on the machine would fail to scan, and the
 * user would be shown an empty plugin list rather than an error. So the Rust
 * source is read at test time and the two sides are pinned against each other.
 *
 * The module's `main()` is guarded by an entry check, so importing it here does
 * not load a native addon or claim `parentPort`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { asScanWorkerRequest, nativeCommand, SCAN_WORKER_COMMAND_ENV, scanWorkerCommand } from '../scanWorker.js';

import type { NativeHost } from '../native.js';

const policySource = readFileSync(resolve('crates/sourdaw-native/src/host/plugin_scan_worker.rs'), 'utf8');

const rustConstant = (name: string): string | undefined =>
    new RegExp(String.raw`pub const ${name}: &str = "([^"]+)"`, 'u').exec(policySource)?.[1];

describe('the launch contract with the Rust policy', () => {
    it('uses the env var name the policy reads', () => {
        // Renaming one side alone leaves the policy re-executing the Electron
        // binary with a bare worker argument, which starts no worker at all.
        expect(rustConstant('SCAN_WORKER_COMMAND_ENV')).toBe(SCAN_WORKER_COMMAND_ENV);
    });

    it('declares the fields the policy deserializes', () => {
        // `program`, `args` and `env` are the `ScanWorkerCommand` struct's serde
        // field names; a mismatch is a parse error at scan time, per plugin.
        const declared: unknown = JSON.parse(JSON.stringify(scanWorkerCommand('/electron', '/app/scanWorker.js')));

        expect(declared).toEqual({
            program: '/electron',
            args: ['/app/scanWorker.js'],
            env: { ELECTRON_RUN_AS_NODE: '1' },
        });
        for (const field of ['program', 'args', 'env']) {
            expect(policySource).toMatch(new RegExp(String.raw`pub ${field}:`, 'u'));
        }
    });

    it('runs the leaf through the Electron binary in its Node role', () => {
        // Without `ELECTRON_RUN_AS_NODE` the child starts as an Electron
        // application — a browser process and a window — once per plugin.
        const command = scanWorkerCommand('/Applications/Sourdaw.app/Contents/MacOS/Sourdaw', '/app/scanWorker.js');

        expect(command.program).toBe('/Applications/Sourdaw.app/Contents/MacOS/Sourdaw');
        expect(command.args).toEqual(['/app/scanWorker.js']);
        expect(command.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    });

    it('leaves the worker arguments to the policy', () => {
        // The declared `args` are a prefix; the policy appends the marker and
        // the two paths. Naming the marker here would be a second definition of
        // it, and the argument-parsing tests already live beside it in Rust.
        expect(scanWorkerCommand('/electron', '/app/scanWorker.js').args).not.toContain(
            rustConstant('WORKER_ARGUMENT')
        );
    });
});

describe('the supervisor request', () => {
    it('accepts a list of roots', () => {
        expect(asScanWorkerRequest({ paths: ['/Library/Audio/Plug-Ins/CLAP'] })).toEqual({
            paths: ['/Library/Audio/Plug-Ins/CLAP'],
        });
        expect(asScanWorkerRequest({ paths: [] })).toEqual({ paths: [] });
    });

    it('refuses anything else rather than scanning a guess', () => {
        // The worker answers a malformed request; it never obeys one. A message
        // that is not a scan request reaching the policy would hand it paths
        // that are not paths.
        for (const message of [undefined, null, 'scan', { paths: '/CLAP' }, { paths: ['/a', 7] }, { roots: [] }]) {
            expect(asScanWorkerRequest(message)).toBeUndefined();
        }
    });
});

describe('reading a method off the addon', () => {
    it('returns the implementation the host publishes', () => {
        const host: NativeHost = { shutdown: () => undefined, scanPlugins: () => ['a'] };

        expect(nativeCommand(host, 'scanPlugins')([])).toEqual(['a']);
    });

    it('fails by name when an addon build does not publish it', () => {
        // `undefined is not a function`, thrown from inside a message handler,
        // gives no way to tell which method a stale addon is missing.
        expect(() => nativeCommand({ shutdown: () => undefined }, 'scanPlugins')).toThrow(
            /does not implement scanPlugins/u
        );
    });
});
