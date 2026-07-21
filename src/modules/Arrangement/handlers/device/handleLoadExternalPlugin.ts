import { findPluginByName } from '#/modules/PluginHost/useCases';
import { createHandler } from '#/utils/createHandler';

import { addTrack } from '../../useCases/addTrack';
import { addExternalDevice } from '../../useCases/device/addExternalDevice';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleLoadExternalPlugin = createHandler<'loadExternalPlugin'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        const { pluginId, trackId: providedTrackId } = alpha.payload;

        let trackId = providedTrackId;
        let didWrite = false;
        if (!trackId) {
            const plugin = findPluginByName(pluginId);
            const isInstrument = plugin?.category.toLowerCase() === 'instrument';
            const newTrack = addTrack({
                name: plugin?.name ?? 'Plugin',
                kind: isInstrument ? 'midi' : 'audio',
            });
            if (!newTrack) {
                return toHandlerExecutionResult(false);
            }
            trackId = newTrack.id;
            didWrite = true;
        }

        const scanned = findPluginByName(pluginId);
        const pluginName = scanned?.name ?? pluginId;
        const device = addExternalDevice(trackId, pluginId, pluginName);
        if (device) {
            didWrite = true;
        }
        return toHandlerExecutionResult(didWrite);
    },
    describe: (alpha) => ({ label: `Load external plugin "${alpha.payload.pluginId}"` }),
    undoable: false,
});
