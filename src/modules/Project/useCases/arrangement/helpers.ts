import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { normalizeTrack } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';

import { arrangementStore } from '../../stores/arrangementStore';
import { type ArrangementSnapshot } from '../../stores/arrangementStore';

export function takeSnapshot(id: string, name: string): ArrangementSnapshot {
    return {
        id,
        name,
        tracks: trackStore.value ?? { tracks: [], selectedTrackId: null },
        automation: automationStore.value ?? { lanes: [] },
        midi: midiStore.value ?? { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        tempoMap: tempoMapStore.value ?? undefined,
        timeSignatureMap: timeSignatureMapStore.value ?? undefined,
        markers: markerStore.value ?? undefined,
        takeLanes: takeLaneStore.value ?? undefined,
    };
}

export function loadSnapshot(data: ArrangementSnapshot): void {
    trackStore.set({
        ...data.tracks,
        tracks: data.tracks.tracks.map(normalizeTrack),
    });
    automationStore.set(data.automation);
    midiStore.set(data.midi);
    // These four fields are optional on a snapshot but always live in shared
    // stores. When the target arrangement's snapshot omits one, reset that store
    // to empty rather than leaving the previous arrangement's value installed —
    // otherwise switching to an arrangement without a tempo map / markers / take
    // lanes leaks the prior arrangement's into the shared store.
    tempoMapStore.set(data.tempoMap ?? { changes: [] });
    timeSignatureMapStore.set(data.timeSignatureMap ?? { changes: [] });
    markerStore.set(data.markers ?? { markers: [], sections: [] });
    takeLaneStore.set(data.takeLanes ?? { lanes: [] });
}

export function syncCurrentArrangementToStore(): void {
    const state = arrangementStore.value;
    if (!state) {
        return;
    }

    const currentArrangement = state.arrangements.find((alpha) => alpha.id === state.activeArrangementId);
    if (!currentArrangement) {
        return;
    }

    const snapshot = takeSnapshot(state.activeArrangementId, currentArrangement.name);

    arrangementStore.set({
        ...state,
        arrangements: state.arrangements.map((alpha) => (alpha.id === state.activeArrangementId ? snapshot : alpha)),
    });
}
