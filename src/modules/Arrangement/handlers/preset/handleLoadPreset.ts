import { createHandler } from '#/utils/createHandler';

import { createTrackFromPreset } from '../../useCases/preset/createTrackFromPreset';
import { loadPresetToTrack } from '../../useCases/preset/presetLoading';
import { getUserPresets } from '../../useCases/preset/presetStorage/getUserPresets';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

function findPresetById(presetId: string) {
    return getUserPresets().find((param) => param.id === presetId) ?? null;
}

export const handleLoadPreset = createHandler<'loadPreset'>({
    execute: (alpha) => {
        const preset = findPresetById(alpha.payload.presetId);
        if (!preset) {
            return toHandlerExecutionResult(false);
        }

        if (alpha.payload.trackId) {
            return toHandlerExecutionResult(loadPresetToTrack(alpha.payload.trackId, preset));
        }

        createTrackFromPreset(preset);
        return toHandlerExecutionResult(true);
    },
    describe: (alpha) => {
        const preset = findPresetById(alpha.payload.presetId);
        const label = preset ? `Load preset "${preset.name}"` : `Load preset ${alpha.payload.presetId}`;
        return { label };
    },
    undoable: true,
});
