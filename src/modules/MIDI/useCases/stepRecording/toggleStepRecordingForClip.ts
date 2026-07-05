import { stepRecordStore } from '../../stores/stepRecordStore';

type ToggleStepRecordingForClipInput = {
    clipId: string;
};

export function toggleStepRecordingForClip({ clipId }: ToggleStepRecordingForClipInput): void {
    const state = stepRecordStore.value;
    if (!state) {
        return;
    }

    const active = !state.active;

    stepRecordStore.set({
        ...state,
        active,
        clipId: active ? clipId : null,
        currentBeat: 0,
    });
}
