import { stepRecordStore } from '../../stores/stepRecordStore';

export function toggleStepRecording(clipId: string | null = null, startBeat = 0): void {
    const current = stepRecordStore.value;
    
    if (current.active && (clipId === null || clipId === current.clipId)) {
        // Deactivate
        stepRecordStore.set({
            ...current,
            active: false,
            clipId: null,
        });
    } else {
        // Activate (or switch clip)
        stepRecordStore.set({
            ...current,
            active: true,
            clipId: clipId,
            currentBeat: startBeat,
        });
    }
}
