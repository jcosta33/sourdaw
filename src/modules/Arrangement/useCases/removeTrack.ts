import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { getTrackById } from '../repositories/track/getTrackById';
import { eventBus } from '#/app/bootstrap';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';

export function removeTrack(trackId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const track = getTrackById(trackId);
    if (!track) {
        return;
    }

    // Collect clip IDs from this track for MIDI/automation cleanup
    const clipIds = new Set(track.clips.map((c) => c.id));

    setTrackState({
        ...state,
        tracks: state.tracks.filter((t) => t.id !== trackId),
        selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
    });

    // Clean up automation lanes for this track
    const autoState = automationStore.value;
    if (autoState) {
        automationStore.set({
            lanes: autoState.lanes.filter((l) => l.trackId !== trackId),
        });
    }

    // Clean up MIDI data for clips on this track
    const midiState = midiStore.value;
    if (midiState && clipIds.size > 0) {
        const newNotes = { ...midiState.notesByClipId };
        const newCC = { ...midiState.ccByClipId };
        const newPB = { ...midiState.pitchBendByClipId };
        for (const clipId of clipIds) {
            delete newNotes[clipId];
            delete newCC[clipId];
            delete newPB[clipId];
        }
        midiStore.set({ notesByClipId: newNotes, ccByClipId: newCC, pitchBendByClipId: newPB });
    }

    // Clean up take lanes for this track
    const takeLane = takeLaneStore.value;
    if (takeLane) {
        takeLaneStore.set({
            lanes: takeLane.lanes.filter((l) => l.trackId !== trackId),
        });
    }

    void eventBus.emit('track.removed', { trackId });
}
