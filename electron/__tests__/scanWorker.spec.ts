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

import { describe, expect, it, vi } from 'vitest';

import {
    asScanWorkerRequest,
    handleScanRequest,
    nativeCommand,
    SCAN_WORKER_COMMAND_ENV,
    scanWorkerCommand,
} from '../scanWorker.js';

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
        // The declared `args` are a prefix; the policy appends the marker, the
        // format, and the two paths. Naming the marker here would be a second
        // definition of it, and the argument-parsing tests already live beside
        // it in Rust.
        expect(scanWorkerCommand('/electron', '/app/scanWorker.js').args).not.toContain(
            rustConstant('WORKER_ARGUMENT')
        );
    });
});

describe('the supervisor request', () => {
    it('accepts a list of roots with no retryQuarantined key', () => {
        // Omitted, not `retryQuarantined: undefined` — the key must be truly
        // absent so a caller cannot tell "omitted" from "explicitly false" by
        // inspecting the parsed shape.
        const request = asScanWorkerRequest({ paths: ['/Library/Audio/Plug-Ins/CLAP'] });
        expect(request).toStrictEqual({ paths: ['/Library/Audio/Plug-Ins/CLAP'] });
        expect(request && 'retryQuarantined' in request).toBe(false);
        expect(asScanWorkerRequest({ paths: [] })).toStrictEqual({ paths: [] });
    });

    it('accepts an explicit retryQuarantined: true', () => {
        expect(asScanWorkerRequest({ paths: ['/CLAP'], retryQuarantined: true })).toStrictEqual({
            paths: ['/CLAP'],
            retryQuarantined: true,
        });
    });

    it('accepts an explicit retryQuarantined: false', () => {
        expect(asScanWorkerRequest({ paths: ['/CLAP'], retryQuarantined: false })).toStrictEqual({
            paths: ['/CLAP'],
            retryQuarantined: false,
        });
    });

    it('refuses a present but non-boolean retryQuarantined rather than dropping it', () => {
        // A caller whose flag never arrives would have every quarantined
        // binary scanned again with no sign the retry request was lost — so a
        // wrong-typed field refuses the whole message instead of falling back
        // to "no retry".
        for (const retryQuarantined of ['true', 1, null, [], {}]) {
            expect(asScanWorkerRequest({ paths: ['/CLAP'], retryQuarantined })).toBeUndefined();
        }
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

describe('handling one supervisor request end to end', () => {
    it('passes an explicit retryQuarantined: true through to the native call', async () => {
        const scanPlugins = vi.fn().mockResolvedValue(['a']);

        const response = await handleScanRequest({ paths: ['/CLAP'], retryQuarantined: true }, scanPlugins);

        expect(scanPlugins).toHaveBeenCalledWith(['/CLAP'], true);
        expect(response).toEqual({ ok: true, result: ['a'] });
    });

    it('passes false to the native call when retryQuarantined is omitted', async () => {
        const scanPlugins = vi.fn().mockResolvedValue([]);

        await handleScanRequest({ paths: ['/CLAP'] }, scanPlugins);

        expect(scanPlugins).toHaveBeenCalledWith(['/CLAP'], false);
    });

    it('answers a malformed message without calling the native addon at all', async () => {
        const scanPlugins = vi.fn();

        const response = await handleScanRequest({ paths: ['/CLAP'], retryQuarantined: 'yes' }, scanPlugins);

        expect(scanPlugins).not.toHaveBeenCalled();
        expect(response).toEqual({ ok: false, error: 'The plugin scan request was malformed' });
    });

    it('answers a rejected scan with its error message', async () => {
        const scanPlugins = vi.fn().mockRejectedValue(new Error('the scan roots are not readable'));

        const response = await handleScanRequest({ paths: ['/CLAP'] }, scanPlugins);

        expect(response).toEqual({ ok: false, error: 'the scan roots are not readable' });
    });
});

// Neither dictation nor granting a file path is reachable through
// `nativeCommand`; these satisfy the host shape and throw so a test that
// somehow routes into one fails loudly.
const unroutableStubs = {
    startDictation: () => {
        throw new Error('Unexpected dictation call: startDictation');
    },
    stopDictation: () => {
        throw new Error('Unexpected dictation call: stopDictation');
    },
    cancelDictation: () => {
        throw new Error('Unexpected dictation call: cancelDictation');
    },
    grantPath: () => {
        throw new Error('Unexpected grant call: grantPath');
    },
} satisfies Pick<NativeHost, 'startDictation' | 'stopDictation' | 'cancelDictation' | 'grantPath'>;

describe('reading a method off the addon', () => {
    it('calls the implementation with the host as its receiver, forwarding the arguments', () => {
        // A plain function, like a napi class method, throws when called with
        // any receiver other than the host it was read off. An implementation
        // that ignored `this` could not distinguish a bound call from a bare
        // reference, so this is what actually observes the binding.
        const host: NativeHost = {
            shutdown: () => undefined,
            ...unroutableStubs,
            scanPlugins(this: unknown, ...args: readonly unknown[]) {
                if (this !== host) {
                    throw new TypeError('Illegal invocation');
                }
                return args;
            },
        };

        expect(nativeCommand(host, 'scanPlugins')(['/CLAP'], true)).toEqual([['/CLAP'], true]);
    });

    it('fails by name when an addon build does not publish it', () => {
        // `undefined is not a function`, thrown from inside a message handler,
        // gives no way to tell which method a stale addon is missing.
        expect(() => nativeCommand({ shutdown: () => undefined, ...unroutableStubs }, 'scanPlugins')).toThrow(
            /does not implement scanPlugins/u
        );
    });
});
