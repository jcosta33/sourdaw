import { stepRecordStore, defaultStepRecordState } from '../../stores/stepRecordStore';
import { getWorkspaceState } from '#/modules/Workspace/useCases';
import { transportStore } from '#/modules/Transport/stores';

export function toggleStepRecording(): void {
    const ws = getWorkspaceState();
    const ts = transportStore.value;
    if (!ws || !ts) return;
    
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
