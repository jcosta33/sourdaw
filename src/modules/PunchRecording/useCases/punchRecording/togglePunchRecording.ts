import { pushUndoEntry } from '#/modules/Command/useCases';
import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { armRetrospectiveCapture, disarmRetrospectiveCapture } from '#/modules/AudioEngine/useCases';

import { punchRecordingStore } from '../../stores/punchRecordingStore';

function selectedEligibleAudioTrackId(): string | null {
    const arrangement = trackStore.value;
    if (!arrangement?.selectedTrackId) {
        return null;
    }
    const selected = arrangement.tracks.find((track) => track.id === arrangement.selectedTrackId);
    if (!selected || selected.kind !== 'audio') {
        return null;
    }
    if (!getTrackEligibility(selected.kind).acceptsRecording) {
        return null;
    }
    return selected.id;
}

function syncRetrospectiveCapture(enabled: boolean): void {
    if (!enabled) {
        disarmRetrospectiveCapture();
        return;
    }
    const trackId = selectedEligibleAudioTrackId();
    if (!trackId) {
        return;
    }
    armRetrospectiveCapture(trackId);
}

export function togglePunchRecording(): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    const previous = state.enabled;
    const next = !previous;
    punchRecordingStore.set({ ...state, enabled: next });
    syncRetrospectiveCapture(next);

    pushUndoEntry(
        next ? 'Enable punch recording' : 'Disable punch recording',
        () => {
            const current = punchRecordingStore.value;
            if (!current) {
                return;
            }
            punchRecordingStore.set({ ...current, enabled: previous });
            syncRetrospectiveCapture(previous);
        },
        () => {
            const current = punchRecordingStore.value;
            if (!current) {
                return;
            }
            punchRecordingStore.set({ ...current, enabled: next });
            syncRetrospectiveCapture(next);
        }
    );
}
