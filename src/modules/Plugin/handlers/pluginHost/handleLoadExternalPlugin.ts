import { addExternalDevice, addTrack } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

import { findPluginByName } from '../../useCases/pluginScan/queries';

export const handleLoadExternalPlugin = createHandler<'loadExternalPlugin'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        const { pluginId, trackId: providedTrackId } = alpha.payload;

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
    describe: (alpha) => ({ label: `Load external plugin "${alpha.payload.pluginId}"` }),
    undoable: false,
});
