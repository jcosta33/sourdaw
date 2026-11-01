import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScopedNativeAddon } from '../createScopedNativeAddon.js';
import { asNativeAddon } from '../native.js';
import { resolveRuntimeScope } from '../runtimeScope.js';

const homes: string[] = [];
const fixture = () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-native-factory-')));
    homes.push(home);
    const root = join(home, '.sourdaw-native-runtime-scopes-v1', randomUUID());
    mkdirSync(root, { recursive: true });
    const scope = resolveRuntimeScope({ SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT: root });
    if (scope === undefined) {
        throw new Error('fixture scope missing');
    }
    for (const path of Object.values(scope.paths)) {
        mkdirSync(path, { recursive: true });
    }
    const receipt: Record<string, unknown> = { ...scope.paths, version: 1, exportStateAvailable: true };
    const legacy = vi.fn();
    class Host {
        static withRuntimeScopeV1 = vi.fn(() => new Host());
        shutdown = vi.fn();
        grantPath = vi.fn();
        beginRendererSession = vi.fn();
        startDictation = vi.fn();
        stopDictation = vi.fn();
        cancelDictation = vi.fn();
        constructor() {
            legacy();
        }
        runtimeScopeInfoV1(): unknown {
            return receipt;
        }
    }
    return { scope, receipt, Host, legacy };
};

afterEach(() => {
    for (const home of homes.splice(0)) {
        rmSync(home, { recursive: true, force: true });
    }
});

describe('preconstruction runtime scope admission', () => {
    it('never constructs an old addon for an explicitly scoped launch', () => {
        const { scope } = fixture();
        const oldConstructor = vi.fn();
        const addon = asNativeAddon({ SourdawNative: oldConstructor }, 'old.node');
        expect(() => createScopedNativeAddon({ addon, scope, onEvent: vi.fn(), requireExportState: true })).toThrow(
            'does not support'
        );
        expect(oldConstructor).not.toHaveBeenCalled();
    });

    it('checks the inspector before calling even an advertised factory', () => {
        const { scope } = fixture();
        const factory = vi.fn();
        class Incomplete {
            static withRuntimeScopeV1 = factory;
        }
        const addon = asNativeAddon({ SourdawNative: Incomplete }, 'incomplete.node');
        expect(() => createScopedNativeAddon({ addon, scope, onEvent: vi.fn(), requireExportState: true })).toThrow(
            'does not support'
        );
        expect(factory).not.toHaveBeenCalled();
    });

    it('uses the exact selected root and checks the producing host receipt', () => {
        const { scope, Host } = fixture();
        const onEvent = vi.fn();
        const host = createScopedNativeAddon({
            addon: asNativeAddon({ SourdawNative: Host }, 'new.node'),
            scope,
            onEvent,
            requireExportState: true,
        });
        expect(Host.withRuntimeScopeV1).toHaveBeenCalledExactlyOnceWith(onEvent, scope.paths.root);
        expect(host).toBeInstanceOf(Host);
    });

    it.each([
        'version',
        'root',
        'data',
        'private',
        'cache',
        'ipc',
        'projects',
        'scanResponses',
        'exportStateAvailable',
    ])('refuses a mismatching %s receipt without retrying the legacy constructor', (key) => {
        const { scope, receipt, Host, legacy } = fixture();
        if (key === 'version') {
            receipt[key] = 2;
        } else if (key === 'exportStateAvailable') {
            receipt[key] = false;
        } else {
            receipt[key] = tmpdir();
        }
        expect(() =>
            createScopedNativeAddon({
                addon: asNativeAddon({ SourdawNative: Host }, 'new.node'),
                scope,
                onEvent: vi.fn(),
                requireExportState: true,
            })
        ).toThrow();
        expect(Host.withRuntimeScopeV1).toHaveBeenCalledOnce();
        expect(legacy).toHaveBeenCalledOnce();
    });

    it('lets a scan supervisor share the home while the main host owns the export lock', () => {
        const { scope, receipt, Host } = fixture();
        receipt.exportStateAvailable = false;
        expect(
            createScopedNativeAddon({
                addon: asNativeAddon({ SourdawNative: Host }, 'new.node'),
                scope,
                onEvent: vi.fn(),
                requireExportState: false,
            })
        ).toBeInstanceOf(Host);
    });

    it('propagates factory failure without constructing a legacy host', () => {
        const { scope, Host, legacy } = fixture();
        Host.withRuntimeScopeV1.mockImplementation(() => {
            throw new Error('selection conflict');
        });
        expect(() =>
            createScopedNativeAddon({
                addon: asNativeAddon({ SourdawNative: Host }, 'new.node'),
                scope,
                onEvent: vi.fn(),
                requireExportState: true,
            })
        ).toThrow('selection conflict');
        expect(legacy).not.toHaveBeenCalled();
    });

    it('preserves the old constructor when no scope is requested', () => {
        const constructor = vi.fn();
        const onEvent = vi.fn();
        createScopedNativeAddon({
            addon: asNativeAddon({ SourdawNative: constructor }, 'old.node'),
            scope: undefined,
            onEvent,
            requireExportState: true,
        });
        expect(constructor).toHaveBeenCalledExactlyOnceWith(onEvent);
    });
});
