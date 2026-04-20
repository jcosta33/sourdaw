import { createHandler } from '#/utils/createHandler';

import { type SoundPresetCategory } from '../../models/SoundPreset';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { saveCurrentAsPreset } from '../../useCases/preset/presetStorage/saveCurrentAsPreset';

export const handleSavePreset = createHandler<'savePreset'>({
    execute: (a) => {
        const state = getTrackStoreState();
        const track = state?.tracks.find((t) => t.id === a.payload.trackId);
        if (!track) {
            return;
        }
        saveCurrentAsPreset({
            name: a.payload.name,
            category: a.payload.category as SoundPresetCategory,
            trackKind: track.kind === 'midi' ? 'midi' : 'audio',
            devices: track.devices.map((d) => ({
                type: d.type,
                name: d.name,
                parameterValues: d.parameterValues,
            })),
        });
    },
    describe: (a) => {
        const track = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
        return { label: `Save preset "${a.payload.name}" from ${track?.name ?? 'track'}` };
    },
    undoable: false,
});
