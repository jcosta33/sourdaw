import { stepRecordStore } from '../../stores/stepRecordStore';

import { refuseStepRecordingOnFrozenTrack } from './refuseStepRecordingOnFrozenTrack';

type ToggleStepRecordingForClipInput = {
    clipId: string;
};

export function toggleStepRecordingForClip({ clipId }: ToggleStepRecordingForClipInput): void {
    const state = stepRecordStore.value;
    if (!state) {
        return;
    }

    const active = !state.active;
    if (active && refuseStepRecordingOnFrozenTrack(clipId)) {
        return;
    }

    stepRecordStore.set({
        ...state,
        active,
        clipId: active ? clipId : null,
        currentBeat: 0,
    });
}
