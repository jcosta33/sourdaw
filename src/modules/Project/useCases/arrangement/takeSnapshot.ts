import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';

import { type ArrangementSnapshot } from '../../stores/arrangementStore';

import { emptySnapshotAutomation, emptySnapshotMidi, emptySnapshotTracks, pickPersistedTracksSection } from './helpers';

function captureMidiSnapshot(): ArrangementSnapshot['midi'] {
    const midi = midiStore.value;
    if (!midi) {
        return {
            notesByClipId: { ...emptySnapshotMidi.notesByClipId },
            ccByClipId: { ...emptySnapshotMidi.ccByClipId },
            pitchBendByClipId: { ...emptySnapshotMidi.pitchBendByClipId },
        };
    }

    const snapshot: ArrangementSnapshot['midi'] = {
        notesByClipId: midi.notesByClipId,
        ccByClipId: midi.ccByClipId,
        pitchBendByClipId: midi.pitchBendByClipId,
    };
    // Only a recognized format may be captured; an unknown stamp must not
    // masquerade as one the restore path trusts.
    if (midi.noteCoordinateFormat === 'clip-relative') {
        snapshot.noteCoordinateFormat = midi.noteCoordinateFormat;
    }
    return snapshot;
}

export function takeSnapshot(id: string, name: string): ArrangementSnapshot {
    return {
        id,
        name,
        tracks: trackStore.value
            ? pickPersistedTracksSection(trackStore.value)
            : { ...emptySnapshotTracks, tracks: [...emptySnapshotTracks.tracks] },
        automation: automationStore.value ?? { lanes: [...emptySnapshotAutomation.lanes] },
        midi: captureMidiSnapshot(),
        tempoMap: tempoMapStore.value ?? undefined,
        timeSignatureMap: timeSignatureMapStore.value ?? undefined,
        markers: markerStore.value ?? undefined,
        takeLanes: takeLaneStore.value ?? undefined,
    };
}
