import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ScannedPlugin } from '../../../../models/ScannedPlugin';
import { defaultPluginScanState, pluginScanStore } from '../../../../stores/pluginScanStore';
import { addPluginFolder } from '../addPluginFolder';
import { refreshPluginFolderGrants } from '../refreshPluginFolderGrants';
import { removePluginFolder } from '../removePluginFolder';

const mocks = vi.hoisted(() => ({
    addPluginFolder: vi.fn<typeof import('../../../../repositories/pluginBridge/addPluginFolder').addPluginFolder>(),
    getPluginFolderGrants:
        vi.fn<typeof import('../../../../repositories/pluginBridge/getPluginFolderGrants').getPluginFolderGrants>(),
    revokePluginFolderGrant:
        vi.fn<typeof import('../../../../repositories/pluginBridge/revokePluginFolderGrant').revokePluginFolderGrant>(),
}));

vi.mock('../../../../repositories/pluginBridge/addPluginFolder', () => ({ addPluginFolder: mocks.addPluginFolder }));
vi.mock('../../../../repositories/pluginBridge/getPluginFolderGrants', () => ({
    getPluginFolderGrants: mocks.getPluginFolderGrants,
}));
vi.mock('../../../../repositories/pluginBridge/revokePluginFolderGrant', () => ({
    revokePluginFolderGrant: mocks.revokePluginFolderGrant,
}));

function plugin(path: string): ScannedPlugin {
    return {
        id: path,
        name: path,
        vendor: 'Vendor',
        format: 'vst3',
        category: 'instrument',
        path,
        version: '1.0.0',
        descriptor_id: `com.test.${path}`,
        num_inputs: 2,
        num_outputs: 2,
        num_parameters: 0,
        has_custom_ui: false,
    };
}

describe('plugin folder grants', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pluginScanStore.set(defaultPluginScanState);
    });

    describe('refreshPluginFolderGrants', () => {
        it('mirrors what the native side reports, unavailable reasons included', async () => {
            mocks.getPluginFolderGrants.mockResolvedValue([
                { path: '/Users/me/Plugins', unavailable_reason: null },
                { path: '/Volumes/USB/Plugins', unavailable_reason: 'The folder is not available' },
            ]);

            await expect(refreshPluginFolderGrants()).resolves.toEqual({ refreshed: true });
            expect(pluginScanStore.value?.grantedFolders).toEqual([
                { path: '/Users/me/Plugins', unavailableReason: null },
                { path: '/Volumes/USB/Plugins', unavailableReason: 'The folder is not available' },
            ]);
        });

        it('keeps the previous list and says why when the query fails', async () => {
            const previous = [{ path: '/Users/me/Plugins', unavailableReason: null }];
            pluginScanStore.set({ ...defaultPluginScanState, grantedFolders: previous });
            mocks.getPluginFolderGrants.mockRejectedValue(new Error('grant store unreadable'));

            await expect(refreshPluginFolderGrants()).resolves.toEqual({
                refreshed: false,
                reason: 'Could not read the added plugin folders: grant store unreadable',
            });
            expect(pluginScanStore.value?.grantedFolders).toEqual(previous);
        });
    });

    describe('addPluginFolder', () => {
        it('refreshes the listed folders after a grant', async () => {
            mocks.addPluginFolder.mockResolvedValue({ status: 'granted', path: '/Users/me/Plugins' });
            mocks.getPluginFolderGrants.mockResolvedValue([{ path: '/Users/me/Plugins', unavailable_reason: null }]);

            await expect(addPluginFolder()).resolves.toEqual({ added: true });
            expect(mocks.getPluginFolderGrants).toHaveBeenCalledTimes(1);
            expect(pluginScanStore.value?.grantedFolders).toEqual([
                { path: '/Users/me/Plugins', unavailableReason: null },
            ]);
        });

        it('passes the native refusal reason through and refreshes nothing', async () => {
            mocks.addPluginFolder.mockResolvedValue({
                status: 'refused',
                reason: '/Volumes/USB is a symlinked folder and cannot be scanned',
            });

            await expect(addPluginFolder()).resolves.toEqual({
                added: false,
                reason: '/Volumes/USB is a symlinked folder and cannot be scanned',
            });
            expect(mocks.getPluginFolderGrants).not.toHaveBeenCalled();
        });

        it('reports a cancelled picker as a cancellation, not a refusal', async () => {
            mocks.addPluginFolder.mockResolvedValue({ status: 'cancelled' });

            await expect(addPluginFolder()).resolves.toEqual({ added: false, cancelled: true });
            expect(mocks.getPluginFolderGrants).not.toHaveBeenCalled();
        });

        it('turns a failed bridge call into a reason rather than a rejection', async () => {
            mocks.addPluginFolder.mockRejectedValue(new TypeError('pluginFolders.add returned an unsupported payload'));

            await expect(addPluginFolder()).resolves.toEqual({
                added: false,
                reason: 'Could not add a plugin folder: pluginFolders.add returned an unsupported payload',
            });
        });
    });

    describe('removePluginFolder', () => {
        it('revokes, refreshes, and drops only the plugins inside the folder', async () => {
            pluginScanStore.set({
                ...defaultPluginScanState,
                grantedFolders: [
                    { path: '/a/Plugins', unavailableReason: null },
                    { path: '/a/Plugins-old', unavailableReason: null },
                ],
                scannedPlugins: [
                    plugin('/a/Plugins/Synth.vst3'),
                    plugin('/a/Plugins/Sub/Delay.clap'),
                    plugin('/a/Plugins-old/Legacy.vst3'),
                    plugin('/Library/Audio/Plug-Ins/VST3/Other.vst3'),
                ],
            });
            mocks.revokePluginFolderGrant.mockResolvedValue(undefined);
            mocks.getPluginFolderGrants.mockResolvedValue([{ path: '/a/Plugins-old', unavailable_reason: null }]);

            await expect(removePluginFolder('/a/Plugins')).resolves.toEqual({ removed: true });

            expect(mocks.revokePluginFolderGrant).toHaveBeenCalledWith('/a/Plugins');
            expect(mocks.revokePluginFolderGrant.mock.invocationCallOrder[0]).toBeLessThan(
                mocks.getPluginFolderGrants.mock.invocationCallOrder[0] ?? 0
            );
            expect(pluginScanStore.value?.grantedFolders).toEqual([
                { path: '/a/Plugins-old', unavailableReason: null },
            ]);
            expect(pluginScanStore.value?.scannedPlugins.map((row) => row.path)).toEqual([
                '/a/Plugins-old/Legacy.vst3',
                '/Library/Audio/Plug-Ins/VST3/Other.vst3',
            ]);
        });

        it('drops plugins under a Windows folder by its own separator', async () => {
            pluginScanStore.set({
                ...defaultPluginScanState,
                scannedPlugins: [plugin('C:\\Plugins\\Synth.vst3'), plugin('C:\\Plugins-old\\Legacy.vst3')],
            });
            mocks.revokePluginFolderGrant.mockResolvedValue(undefined);
            mocks.getPluginFolderGrants.mockResolvedValue([]);

            await removePluginFolder('C:\\Plugins');

            expect(pluginScanStore.value?.scannedPlugins.map((row) => row.path)).toEqual([
                'C:\\Plugins-old\\Legacy.vst3',
            ]);
        });

        it('keeps the folder and its plugins when the revoke fails', async () => {
            const state = {
                ...defaultPluginScanState,
                grantedFolders: [{ path: '/a/Plugins', unavailableReason: null }],
                scannedPlugins: [plugin('/a/Plugins/Synth.vst3')],
            };
            pluginScanStore.set(state);
            mocks.revokePluginFolderGrant.mockRejectedValue(new Error('grant store is read-only'));

            await expect(removePluginFolder('/a/Plugins')).resolves.toEqual({
                removed: false,
                reason: 'Could not remove /a/Plugins: grant store is read-only',
            });
            expect(pluginScanStore.value).toEqual(state);
            expect(mocks.getPluginFolderGrants).not.toHaveBeenCalled();
        });

        it('still drops the revoked folder when the refresh after it fails', async () => {
            pluginScanStore.set({
                ...defaultPluginScanState,
                grantedFolders: [
                    { path: '/a/Plugins', unavailableReason: null },
                    { path: '/b/Plugins', unavailableReason: null },
                ],
            });
            mocks.revokePluginFolderGrant.mockResolvedValue(undefined);
            mocks.getPluginFolderGrants.mockRejectedValue(new Error('grant store unreadable'));

            await expect(removePluginFolder('/a/Plugins')).resolves.toEqual({ removed: true });
            expect(pluginScanStore.value?.grantedFolders).toEqual([{ path: '/b/Plugins', unavailableReason: null }]);
        });
    });
});
