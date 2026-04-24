import { createHandler } from '#/utils/createHandler';

import { type SoundPresetCategory } from '../../models/SoundPreset';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { saveCurrentAsPreset } from '../../useCases/preset/presetStorage/saveCurrentAsPreset';

export const handleSavePreset = createHandler<'savePreset'>({
    execute: (alpha) => {
        const state = getTrackStoreState();
        const track = state?.tracks.find((time) => time.id === alpha.payload.trackId);
        if (!track) {
            return;
        }
        saveCurrentAsPreset({
            name: alpha.payload.name,
            category: alpha.payload.category as SoundPresetCategory,
            trackKind: track.kind === 'midi' ? 'midi' : 'audio',
            devices: track.devices.map((data) => ({
                type: data.type,
                name: data.name,
                parameterValues: data.parameterValues,
            })),
        });
    },
    describe: (alpha) => {
        const track = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return { label: `Save preset "${alpha.payload.name}" from ${track?.name ?? 'track'}` };
    },
    undoable: false,
});
