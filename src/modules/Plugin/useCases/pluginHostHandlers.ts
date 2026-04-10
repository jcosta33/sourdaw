import { findPluginByName } from './pluginScan/queries';
import { startPluginScan } from './pluginScan/scanning';
import { addTrack, addExternalDevice } from '#/modules/Arrangement';

type PluginHostHandlerDescription = {
    label: string;
};

type PluginHostHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => PluginHostHandlerDescription;
    undoable: boolean;
};

type PluginHostAction =
    | { type: 'scanPlugins'; payload?: undefined }
    | { type: 'loadExternalPlugin'; payload: { pluginId: string; trackId?: string } };

type PluginHostActionOf<ActionType extends PluginHostAction['type']> = Extract<
    PluginHostAction,
    { type: ActionType }
>;

type PluginHostHandlers = {
    scanPlugins: PluginHostHandler<PluginHostActionOf<'scanPlugins'>>;
    loadExternalPlugin: PluginHostHandler<PluginHostActionOf<'loadExternalPlugin'>>;
};

export const pluginHostHandlers: PluginHostHandlers = {
    scanPlugins: {
        execute: async () => {
            await startPluginScan();
        },
        describe: () => ({ label: 'Scan external plugins' }),
        undoable: false,
    },

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
    },
};
