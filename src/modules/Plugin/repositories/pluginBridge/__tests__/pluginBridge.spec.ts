import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPlugin } from '../loadPlugin';
import { unloadPlugin } from '../unloadPlugin';
import { scanPlugins } from '../scanPlugins';
import { setPluginParameter } from '../setPluginParameter';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

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
            expect(tauriInvoke).toHaveBeenCalledWith('set_plugin_parameter', { instanceId: 'i1', paramId: 0, value: 0.5 });
        });
    });
});
