import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { loadPlugin } from '../loadPlugin';
import { processAudioIPC } from '../processAudioIPC';
import { scanPlugins } from '../scanPlugins';
import { setPluginParameter } from '../setPluginParameter';
import { setPluginState } from '../setPluginState';
import { unloadPlugin } from '../unloadPlugin';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

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

    describe('setPluginState', () => {
        it('should send the Rust command argument key in desktop', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            await setPluginState('i1', [1, 2, 3]);
            expect(tauriInvoke).toHaveBeenCalledWith('set_plugin_state', {
                instanceId: 'i1',
                pluginState: [1, 2, 3],
            });
        });
    });

    describe('processAudioIPC', () => {
        it('returns no processed bytes outside the desktop app', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const audioBytes = new Uint8Array([1, 2, 3]);
            const result = await processAudioIPC({ enginePluginId: 17, audioBytes });
            expect(result).toBeNull();
            expect(tauriInvoke).not.toHaveBeenCalled();
        });

        it('sends native plugin audio bytes to the registered bridge command', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            const processedBytes = new Uint8Array([4, 5, 6]);
            vi.mocked(tauriInvoke).mockResolvedValue(processedBytes);

            const pool = new Uint8Array([9, 9, 1, 2, 3]);
            const audioBytes = pool.subarray(2);

            const result = await processAudioIPC({ enginePluginId: 17, audioBytes });

            expect(tauriInvoke).toHaveBeenCalledWith('process_plugin_audio', {
                enginePluginId: 17,
                audioBytes,
            });
            expect(result).toBe(processedBytes);
        });

        it('returns no processed bytes when the native response is not binary', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockResolvedValue([1, 2, 3]);

            const result = await processAudioIPC({
                enginePluginId: 17,
                audioBytes: new Uint8Array([1, 2, 3]),
            });

            expect(result).toBeNull();
        });

        it('returns no processed bytes when the native command fails', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockRejectedValue(new Error('native failed'));

            const result = await processAudioIPC({
                enginePluginId: 17,
                audioBytes: new Uint8Array([1, 2, 3]),
            });

            expect(result).toBeNull();
        });
    });
});
