import { createHandler } from '#/utils/createHandler';

import { createTrackFromPreset } from '../../useCases/preset/createTrackFromPreset';
import { loadPresetToTrack } from '../../useCases/preset/presetLoading';
import { getUserPresets } from '../../useCases/preset/presetStorage/getUserPresets';

function findPresetById(presetId: string) {
    return getUserPresets().find((param) => param.id === presetId) ?? null;
}

export const handleLoadPreset = createHandler<'loadPreset'>({
    execute: (alpha) => {
        const preset = findPresetById(alpha.payload.presetId);
        if (!preset) {
            return;
        }

        if (alpha.payload.trackId) {
            loadPresetToTrack(alpha.payload.trackId, preset);
        } else {
            createTrackFromPreset(preset);
        }
    },
    describe: (alpha) => {
        const preset = findPresetById(alpha.payload.presetId);
        const label = preset ? `Load preset "${preset.name}"` : `Load preset ${alpha.payload.presetId}`;
        return { label };
    },
    undoable: true,
});
