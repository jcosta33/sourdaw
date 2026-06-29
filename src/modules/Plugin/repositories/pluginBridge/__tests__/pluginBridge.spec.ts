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
            await setPluginParameter('i1', 0, 0.5);
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
        it('returns the input unchanged outside the desktop app', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const input = new Float32Array([0.1, -0.2, 0.3]);
            const result = await processAudioIPC('i1', input);
            expect(result).toBe(input);
            expect(tauriInvoke).not.toHaveBeenCalled();
        });

        it('sends a view with a nonzero byteOffset verbatim, not from the buffer start', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(tauriInvoke).mockResolvedValue(new Uint8Array(new Float32Array([0]).buffer));

            // A Float32Array windowed into a larger pooled buffer at frame 2.
            const pool = new Float32Array([9, 9, 1.5, -2.5, 0.25]);
            const view = pool.subarray(2); // bytes 8..20, byteOffset === 8

            await processAudioIPC('i1', view);

            const body = vi.mocked(tauriInvoke).mock.calls[0]?.[1] as { body: Uint8Array };
            // The bytes sent must be exactly the view's three samples, not the
            // leading pool samples that share the backing buffer.
            const sent = new Float32Array(body.body.buffer, body.body.byteOffset, body.body.byteLength / 4);
            expect(Array.from(sent)).toEqual([1.5, -2.5, 0.25]);
        });

        it('reconstitutes samples from a response view with a nonzero byteOffset', async () => {
            vi.mocked(isTauri).mockReturnValue(true);

            // Rust returns a Uint8Array that is a window into a larger buffer:
            // four leading padding bytes, then the real Float32 payload.
            const payload = new Float32Array([0.5, -0.75, 1.25]);
            const backing = new Uint8Array(4 + payload.byteLength);
            backing.set(new Uint8Array(payload.buffer), 4);
            const responseView = backing.subarray(4); // byteOffset === 4
            vi.mocked(tauriInvoke).mockResolvedValue(responseView);

            const result = await processAudioIPC('i1', new Float32Array([0, 0, 0]));

            expect(Array.from(result)).toEqual([0.5, -0.75, 1.25]);
        });
    });
});
