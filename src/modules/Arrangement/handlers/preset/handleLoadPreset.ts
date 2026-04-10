import { createHandler } from '#/helpers/createHandler';
import { getUserPresets } from '../../useCases/preset/presetStorage';
import { loadPresetToTrack, createTrackFromPreset } from '../../useCases/preset/presetLoading';

function findPresetById(presetId: string) {
    return getUserPresets().find((p) => p.id === presetId) ?? null;
}

export const handleLoadPreset = createHandler<'loadPreset'>({
    execute: (a) => {
        const preset = findPresetById(a.payload.presetId);
        if (!preset) {
            return;
        }

        if (a.payload.trackId) {
            loadPresetToTrack(a.payload.trackId, preset);
        } else {
            createTrackFromPreset(preset);
        }
    },
    describe: (a) => {
        const preset = findPresetById(a.payload.presetId);
        const label = preset ? `Load preset "${preset.name}"` : `Load preset ${a.payload.presetId}`;
        return { label };
    },
    undoable: true,
});
