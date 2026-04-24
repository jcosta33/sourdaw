import { findPluginByName } from '#/modules/Plugin/useCases';
import { createHandler } from '#/utils/createHandler';

import { addTrack } from '../../useCases/addTrack';
import { addExternalDevice } from '../../useCases/device/addExternalDevice';

export const handleLoadExternalPlugin = createHandler<'loadExternalPlugin'>({
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
});
