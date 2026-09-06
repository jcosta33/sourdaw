import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isDesktopRuntime, desktopInvoke, desktopListen } from '#/utils/desktopBridge';

import { isScanPathAuthorized } from '../isScanPathAuthorized';
import { loadPlugin } from '../loadPlugin';
import { onPluginLatencyChanged } from '../onPluginLatencyChanged';
import { scanPlugins } from '../scanPlugins';
import { setPluginBypass } from '../setPluginBypass';
import { setPluginParameter } from '../setPluginParameter';
import { unloadPlugin } from '../unloadPlugin';

import type { PluginLatencyChange } from '../types';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
    desktopListen: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));

describe('pluginBridge repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('loadPlugin', () => {
        it('should return unavailable in browser', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(false);
            const result = await loadPlugin('p1', 'i1', 44_100);
            expect(result.name).toBe('Unavailable');
            expect(desktopInvoke).not.toHaveBeenCalled();
        });

        it('should invoke the desktop command', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            const mockInstance = { instance_id: 'i1', name: 'FabFilter Pro-Q 3' };
            vi.mocked(desktopInvoke).mockResolvedValue(mockInstance);

            const result = await loadPlugin('p1', 'i1', 44_100);
            expect(desktopInvoke).toHaveBeenCalledWith('load_plugin', {
                pluginId: 'p1',
                instanceId: 'i1',
                sampleRate: 44_100,
            });
            expect(result).toEqual(mockInstance);
        });
    });

    describe('unloadPlugin', () => {
        it('should invoke the desktop command', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(desktopInvoke).mockResolvedValue({ unloadedInstanceIds: ['i1'], errors: [], reports: [] });
            await unloadPlugin('i1');
            expect(desktopInvoke).toHaveBeenCalledWith('unload_plugin', { instanceId: 'i1' });
        });

        it('parses the released strip reports the reply carries', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(desktopInvoke).mockResolvedValue({
                unloadedInstanceIds: ['i1'],
                errors: [],
                reports: [{ kind: 'track', id: 'lead', deviceIds: ['comp', 'limiter'] }],
            });

            const result = await unloadPlugin('i1');

            expect(result.reports).toEqual([{ kind: 'track', id: 'lead', deviceIds: ['comp', 'limiter'] }]);
        });

        it('throws on a malformed strip report instead of handing a foreign module bad ids', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(desktopInvoke).mockResolvedValue({
                unloadedInstanceIds: ['i1'],
                errors: [],
                reports: [{ kind: 'track', id: 'lead', deviceIds: [7] }],
            });

            await expect(unloadPlugin('i1')).rejects.toThrow('Invalid unload_plugin response');
        });
    });

    describe('scanPlugins', () => {
        it('reports that no scan ran in the browser instead of an empty result', async () => {
            // The browser answer must not look like an enumeration: an empty
            // `plugins` array is a legitimate desktop result, and the store
            // write decision turns on telling the two apart.
            vi.mocked(isDesktopRuntime).mockReturnValue(false);
            const attempt = await scanPlugins(['/path']);
            expect(attempt).toEqual({ ran: false, reason: 'Plugin scanning requires the desktop app' });
            expect(desktopInvoke).not.toHaveBeenCalled();
        });

        it('should invoke the desktop command', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(desktopInvoke).mockResolvedValue({ plugins: [], errors: [], scan_duration_ms: 10 });
            const attempt = await scanPlugins(['/path']);
            expect(desktopInvoke).toHaveBeenCalledWith('scan_plugins', { paths: ['/path'] });
            expect(attempt).toEqual({ ran: true, result: { plugins: [], errors: [], scan_duration_ms: 10 } });
        });

        it('forwards an explicit retry request, unlike the default call', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(desktopInvoke).mockResolvedValue({ plugins: [], errors: [], scan_duration_ms: 10 });
            await scanPlugins(['/path'], true);
            expect(desktopInvoke).toHaveBeenCalledWith('scan_plugins', { paths: ['/path'], retryQuarantined: true });
        });
    });

    describe('setPluginParameter', () => {
        it('should invoke the desktop command', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            await setPluginParameter({ instanceId: 'i1', paramId: 0, value: 0.5 });
            expect(desktopInvoke).toHaveBeenCalledWith('set_plugin_parameter', {
                instanceId: 'i1',
                paramId: 0,
                value: 0.5,
            });
        });
    });

    describe('setPluginBypass', () => {
        it('addresses the native graph by instance id, the key both sides share', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            await setPluginBypass({ instanceId: 'i1', bypassed: true });
            expect(desktopInvoke).toHaveBeenCalledWith('set_plugin_bypass', {
                instanceId: 'i1',
                bypassed: true,
            });
        });

        it('stays off the wire in the browser, where there is no native graph', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(false);
            await setPluginBypass({ instanceId: 'i1', bypassed: true });
            expect(desktopInvoke).not.toHaveBeenCalled();
        });
    });

    describe('isScanPathAuthorized', () => {
        it('refuses every path outside the desktop app, where there is no policy to ask', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(false);

            expect(await isScanPathAuthorized('/any/path')).toBe(false);
            expect(desktopInvoke).not.toHaveBeenCalled();
        });

        it('asks the native scan policy for the verdict the add-path gate runs on', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(desktopInvoke).mockResolvedValue(true);

            expect(await isScanPathAuthorized('/root/child')).toBe(true);
            expect(desktopInvoke).toHaveBeenCalledWith('is_scan_path_authorized', { path: '/root/child' });
        });
    });

    // getPluginState / setPluginState no longer travel over `desktopInvoke` — they
    // use the binary IPC path, whose wire shape (raw body, instance header, byte
    // fidelity) is covered in `pluginStateBinaryIpc.spec.ts`.

    describe('onPluginLatencyChanged', () => {
        it('does not subscribe outside the desktop app and returns a usable unlisten', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(false);
            const handler = vi.fn<(change: PluginLatencyChange) => void>();

            const unlisten = await onPluginLatencyChanged(handler);

            expect(desktopListen).not.toHaveBeenCalled();
            expect(() => unlisten()).not.toThrow();
            expect(handler).not.toHaveBeenCalled();
        });

        it('unwraps the native event envelope and hands the change to the handler', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            let emit: ((payload: unknown) => void) | undefined;
            const unlistenSpy = vi.fn();
            vi.mocked(desktopListen).mockImplementation((_event, listener) => {
                emit = listener;
                return Promise.resolve(unlistenSpy);
            });
            const handler = vi.fn<(change: PluginLatencyChange) => void>();

            const unlisten = await onPluginLatencyChanged(handler);

            expect(desktopListen).toHaveBeenCalledWith('plugin-latency-changed', expect.any(Function));
            emit?.({ payload: { instance_id: 'inst-1', latency_ms: 12.5 } });
            expect(handler).toHaveBeenCalledWith({ instance_id: 'inst-1', latency_ms: 12.5 });

            expect(unlisten).toBe(unlistenSpy);
        });

        it('drops malformed payloads instead of reporting a non-numeric latency', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            let emit: ((payload: unknown) => void) | undefined;
            vi.mocked(desktopListen).mockImplementation((_event, listener) => {
                emit = listener;
                return Promise.resolve(() => {});
            });
            const handler = vi.fn<(change: PluginLatencyChange) => void>();

            await onPluginLatencyChanged(handler);

            emit?.({ payload: { instance_id: 'inst-1', latency_ms: 'lots' } });
            emit?.({ payload: { instance_id: 'inst-1' } });
            emit?.({ payload: { instance_id: 7, latency_ms: 3 } });
            emit?.({ payload: null });
            emit?.({});

            expect(handler).not.toHaveBeenCalled();

            // A well-formed change after the bad ones still lands.
            emit?.({ payload: { instance_id: 'inst-1', latency_ms: 0 } });
            expect(handler).toHaveBeenCalledWith({ instance_id: 'inst-1', latency_ms: 0 });
        });
    });
});
