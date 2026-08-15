import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke, tauriListen } from '#/utils/tauriBridge';

import { loadPlugin } from '../loadPlugin';
import { onPluginLatencyChanged } from '../onPluginLatencyChanged';
import { processAudioIPC } from '../processAudioIPC';
import { scanPlugins } from '../scanPlugins';
import { setPluginParameter } from '../setPluginParameter';
import { unloadPlugin } from '../unloadPlugin';

import type { PluginLatencyChange } from '../types';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
    tauriListen: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));

describe('pluginBridge repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('loadPlugin', () => {
        it('should return unavailable in browser', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const result = await loadPlugin('p1', 'i1');
            expect(result.name).toBe('Unavailable');
            expect(tauriInvoke).not.toHaveBeenCalled();
        });

        it('should invoke tauri in desktop', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            const mockInstance = { instance_id: 'i1', name: 'FabFilter Pro-Q 3' };
            vi.mocked(tauriInvoke).mockResolvedValue(mockInstance);

            const result = await loadPlugin('p1', 'i1');
            expect(tauriInvoke).toHaveBeenCalledWith('load_plugin', { pluginId: 'p1', instanceId: 'i1' });
            expect(result).toEqual(mockInstance);
        });
    });

    describe('unloadPlugin', () => {
        it('should invoke tauri in desktop', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockResolvedValue([['i1'], []]);
            await unloadPlugin('i1');
            expect(tauriInvoke).toHaveBeenCalledWith('unload_plugin', { instanceId: 'i1' });
        });
    });

    describe('scanPlugins', () => {
        it('should return error in browser', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const result = await scanPlugins(['/path']);
            expect(result.errors).toContain('Plugin scanning requires the desktop app');
        });

        it('should invoke tauri in desktop', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockResolvedValue({ plugins: [], errors: [], scan_duration_ms: 10 });
            await scanPlugins(['/path']);
            expect(tauriInvoke).toHaveBeenCalledWith('scan_plugins', { paths: ['/path'] });
        });
    });

    describe('setPluginParameter', () => {
        it('should invoke tauri in desktop', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            await setPluginParameter({ instanceId: 'i1', paramId: 0, value: 0.5 });
            expect(tauriInvoke).toHaveBeenCalledWith('set_plugin_parameter', {
                instanceId: 'i1',
                paramId: 0,
                value: 0.5,
            });
        });
    });

    // getPluginState / setPluginState no longer travel over `tauriInvoke` — they
    // use the binary IPC path, whose wire shape (raw body, instance header, byte
    // fidelity) is covered in `pluginStateBinaryIpc.spec.ts`.

    describe('processAudioIPC', () => {
        it('returns no processed bytes outside the desktop app', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const audioBytes = new Uint8Array([1, 2, 3]);
            const result = await processAudioIPC({ instanceId: 'instance-17', audioBytes });
            expect(result).toBeNull();
            expect(tauriInvoke).not.toHaveBeenCalled();
        });

        it('sends native plugin audio bytes to the registered bridge command', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            const processedBytes = new Uint8Array([4, 5, 6]);
            vi.mocked(tauriInvoke).mockResolvedValue(processedBytes);

            const pool = new Uint8Array([9, 9, 1, 2, 3]);
            const audioBytes = pool.subarray(2);

            const result = await processAudioIPC({ instanceId: 'instance-17', audioBytes });

            expect(tauriInvoke).toHaveBeenCalledWith('process_plugin_audio', {
                instanceId: 'instance-17',
                audioBytes,
            });
            expect(result).toEqual(processedBytes);
        });

        it('normalizes byte arrays returned by the registered bridge command', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockResolvedValue([1, 2, 3]);

            const result = await processAudioIPC({
                instanceId: 'instance-17',
                audioBytes: new Uint8Array([1, 2, 3]),
            });

            expect(result).toEqual(new Uint8Array([1, 2, 3]));
        });

        it('normalizes typed-array views returned by the registered bridge command', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            const backing = new Uint8Array([9, 9, 4, 5, 6]);
            vi.mocked(tauriInvoke).mockResolvedValue(backing.subarray(2));

            const result = await processAudioIPC({
                instanceId: 'instance-17',
                audioBytes: new Uint8Array([1, 2, 3]),
            });

            expect(result).toEqual(new Uint8Array([4, 5, 6]));
            expect(result?.buffer.byteLength).toBe(3);
        });

        it('returns no processed bytes when the native response is not audio bytes', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockResolvedValue([1, -1, 300]);

            const result = await processAudioIPC({
                instanceId: 'instance-17',
                audioBytes: new Uint8Array([1, 2, 3]),
            });

            expect(result).toBeNull();
        });

        it('returns no processed bytes when the native command fails', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockRejectedValue(new Error('native failed'));

            const result = await processAudioIPC({
                instanceId: 'instance-17',
                audioBytes: new Uint8Array([1, 2, 3]),
            });

            expect(result).toBeNull();
        });

        // Regression (F14): the failure used to be swallowed whole, so a stopped
        // engine, an unresolved instance and a plugin that simply produced
        // nothing were indistinguishable to anyone reading the app.
        it('reports each distinct native failure once instead of swallowing it', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockRejectedValue(new Error('no audio bridge for plugin 17'));

            await processAudioIPC({ instanceId: 'instance-17', audioBytes: new Uint8Array([1]) });

            expect(logger.warn).toHaveBeenCalledWith(
                'Native plugin audio processing failed: Error: no audio bridge for plugin 17'
            );

            // The relay issues hundreds of round trips a second: the same cause
            // repeating must not be logged again.
            await processAudioIPC({ instanceId: 'instance-17', audioBytes: new Uint8Array([1]) });
            expect(logger.warn).toHaveBeenCalledTimes(1);

            // A different cause is a different report.
            vi.mocked(tauriInvoke).mockRejectedValue(new Error('Native engine not running'));
            await processAudioIPC({ instanceId: 'instance-17', audioBytes: new Uint8Array([1]) });

            expect(logger.warn).toHaveBeenCalledTimes(2);
            expect(logger.warn).toHaveBeenLastCalledWith(
                'Native plugin audio processing failed: Error: Native engine not running'
            );
        });

        it('reports a failure again after the round trip recovers', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockRejectedValue(new Error('device disappeared'));
            await processAudioIPC({ instanceId: 'instance-17', audioBytes: new Uint8Array([1]) });
            expect(logger.warn).toHaveBeenCalledTimes(1);

            vi.mocked(tauriInvoke).mockResolvedValue(new Uint8Array([1]));
            await processAudioIPC({ instanceId: 'instance-17', audioBytes: new Uint8Array([1]) });

            vi.mocked(tauriInvoke).mockRejectedValue(new Error('device disappeared'));
            await processAudioIPC({ instanceId: 'instance-17', audioBytes: new Uint8Array([1]) });

            expect(logger.warn).toHaveBeenCalledTimes(2);
        });
    });

    describe('onPluginLatencyChanged', () => {
        it('does not subscribe outside the desktop app and returns a usable unlisten', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const handler = vi.fn<(change: PluginLatencyChange) => void>();

            const unlisten = await onPluginLatencyChanged(handler);

            expect(tauriListen).not.toHaveBeenCalled();
            expect(() => unlisten()).not.toThrow();
            expect(handler).not.toHaveBeenCalled();
        });

        it('unwraps the native event envelope and hands the change to the handler', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            let emit: ((payload: unknown) => void) | undefined;
            const unlistenSpy = vi.fn();
            vi.mocked(tauriListen).mockImplementation((_event, listener) => {
                emit = listener;
                return Promise.resolve(unlistenSpy);
            });
            const handler = vi.fn<(change: PluginLatencyChange) => void>();

            const unlisten = await onPluginLatencyChanged(handler);

            expect(tauriListen).toHaveBeenCalledWith('plugin-latency-changed', expect.any(Function));
            emit?.({ payload: { instance_id: 'inst-1', latency_ms: 12.5 } });
            expect(handler).toHaveBeenCalledWith({ instance_id: 'inst-1', latency_ms: 12.5 });

            expect(unlisten).toBe(unlistenSpy);
        });

        it('drops malformed payloads instead of reporting a non-numeric latency', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            let emit: ((payload: unknown) => void) | undefined;
            vi.mocked(tauriListen).mockImplementation((_event, listener) => {
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
