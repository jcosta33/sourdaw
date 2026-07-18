import { clipSelectionStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { stepRecordStore, defaultStepRecordState } from '../../stores/stepRecordStore';

export function toggleStepRecording(): void {
    const ws = clipSelectionStore.value;
    const ts = transportStore.value;
    if (!ws || !ts) {
        return;
    }

    const current = stepRecordStore.value;
    const nextActive = !current?.active;

    if (nextActive) {
        stepRecordStore.set({
            ...defaultStepRecordState,
            active: true,
            clipId: ws.selectedClipId,
            currentBeat: ts.playheadPosition,
        });
    } else {
        stepRecordStore.set(null);
    }
}
