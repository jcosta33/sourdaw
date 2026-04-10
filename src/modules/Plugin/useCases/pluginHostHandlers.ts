import { inject } from '#/infra/di/inject';
import { addExternalDevice, addTrack } from '#/modules/Arrangement';
import { type ActionHandler, type AppAction } from '#/modules/Command';
import { findPluginByName, startPluginScan } from '#/modules/Plugin';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeScanPlugins = inject({ startPluginScan })(
    ({ startPluginScan }) =>
        async function executeScanPlugins(): Promise<void> {
            await startPluginScan();
        }
);

export const executeLoadExternalPlugin = inject({ findPluginByName, addTrack, addExternalDevice })(
    ({ findPluginByName, addTrack, addExternalDevice }) =>
        async function executeLoadExternalPlugin(a: Extract<AppAction, 'loadExternalPlugin'>): Promise<void> {
            const { pluginId, trackId: providedTrackId } = a.payload;

            let trackId = providedTrackId;
            if (!trackId) {
                const plugin = findPluginByName(pluginId);
                const isInstrument = plugin?.category.toLowerCase() === 'instrument';
                const newTrack = addTrack({
                    name: plugin?.name ?? 'Plugin',
                    kind: isInstrument ? 'midi' : 'audio',
                });
                if (!newTrack) {
                    return;
                }
                trackId = newTrack.id;
            }

            const scanned = findPluginByName(pluginId);
            const pluginName = scanned?.name ?? pluginId;
            addExternalDevice(trackId, pluginId, pluginName);
        }
);

export const pluginHostHandlers = {
    scanPlugins: {
        execute: executeScanPlugins,
        describe: () => ({ label: 'Scan external plugins' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'scanPlugins'>>,

    loadExternalPlugin: {
        execute: executeLoadExternalPlugin,
        describe: (a) => ({ label: `Load external plugin "${a.payload.pluginId}"` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'loadExternalPlugin'>>,
};
