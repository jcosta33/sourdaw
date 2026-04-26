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
    if (data.tempoMap) {
        tempoMapStore.set(data.tempoMap);
    }
    if (data.timeSignatureMap) {
        timeSignatureMapStore.set(data.timeSignatureMap);
    }
    if (data.markers) {
        markerStore.set(data.markers);
    }
    if (data.takeLanes) {
        takeLaneStore.set(data.takeLanes);
    }
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
