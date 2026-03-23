import { type ActionHandler } from '#/modules/Command/models/ActionHandler';
import { type AppAction } from '#/modules/Command/models/AppAction';
import { startPluginScan, findPluginByName } from '#/modules/Plugin/useCases/pluginScanUseCases';
import { addTrack } from '#/modules/Track/useCases/addTrack';
import { addExternalDevice } from '#/modules/Track/useCases/deviceUseCases';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const pluginHostHandlers = {
    scanPlugins: {
        execute: async () => {
            await startPluginScan();
        },
        describe: () => ({ label: 'Scan external plugins' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'scanPlugins'>>,

    loadExternalPlugin: {
        execute: async (a) => {
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
        },
        describe: (a) => ({ label: `Load external plugin "${a.payload.pluginId}"` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'loadExternalPlugin'>>,
};
