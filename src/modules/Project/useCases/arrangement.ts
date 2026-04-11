import { inject } from '#/infra/di/inject';
import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';
import { stopPlayback } from '#/modules/Transport/useCases';
import { arrangementStore } from '../stores/arrangementStore';
import { type ArrangementSnapshot } from '../stores/arrangementStore';
import { markDirty } from './projectPersistence/saveProject';

export const arrangementOrchestrationDependencies = {
    stopPlayback,
    markDirty,
} as const;

function takeSnapshot(id: string, name: string): ArrangementSnapshot {
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

function loadSnapshot(data: ArrangementSnapshot): void {
    trackStore.set(data.tracks);
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

    const currentArrangement = state.arrangements.find((a) => a.id === state.activeArrangementId);
    if (!currentArrangement) {
        return;
    }

    const snapshot = takeSnapshot(state.activeArrangementId, currentArrangement.name);

    arrangementStore.set({
        ...state,
        arrangements: state.arrangements.map((a) => (a.id === state.activeArrangementId ? snapshot : a)),
    });
}

export const switchArrangement = inject(arrangementOrchestrationDependencies)(
    ({ stopPlayback, markDirty }) =>
        function switchArrangement(id: string): void {
            const state = arrangementStore.value;
            if (!state || state.activeArrangementId === id) {
                return;
            }

            const target = state.arrangements.find((a) => a.id === id);
            if (!target) {
                return;
            }

            stopPlayback(); // Stop playback to avoid glitches

            // Save current
            syncCurrentArrangementToStore();

            // Load target
            loadSnapshot(target);

            // Clear undo history because IDs might have been reused or destroyed
            clearUndoHistory();

            arrangementStore.set({
                ...arrangementStore.value!,
                activeArrangementId: id,
            });

            markDirty();
        }
);

export const createArrangement = inject(arrangementOrchestrationDependencies)(
    ({ markDirty }) =>
        function createArrangement(name: string): void {
            const state = arrangementStore.value;
            if (!state) {
                return;
            }

            const id = `arr-${crypto.randomUUID().slice(0, 8)}`;

            syncCurrentArrangementToStore(); // Save current to its slot before switching

            const newArrangement: ArrangementSnapshot = {
                id,
                name,
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            };

            arrangementStore.set({
                arrangements: [...state.arrangements, newArrangement],
                activeArrangementId: id,
            });

            loadSnapshot(newArrangement);
            clearUndoHistory();
            markDirty();
        }
);

export const duplicateArrangement = inject(arrangementOrchestrationDependencies)(
    ({ markDirty }) =>
        function duplicateArrangement(id: string, newName?: string): void {
            const state = arrangementStore.value;
            if (!state) {
                return;
            }

            syncCurrentArrangementToStore(); // Ensure latest state is snapshotted

            const sourceArrangement = arrangementStore.value!.arrangements.find((a) => a.id === id);
            if (!sourceArrangement) {
                return;
            }

            // Deep clone to avoid mutating shared object references
            const clone = JSON.parse(JSON.stringify(sourceArrangement)) as ArrangementSnapshot;
            clone.id = `arr-${crypto.randomUUID().slice(0, 8)}`;
            clone.name = newName || `${sourceArrangement.name} (Copy)`;

            arrangementStore.set({
                arrangements: [...state.arrangements, clone],
                activeArrangementId: clone.id,
            });

            loadSnapshot(clone);
            clearUndoHistory();
            markDirty();
        }
);

export const renameArrangement = inject(arrangementOrchestrationDependencies)(
    ({ markDirty }) =>
        function renameArrangement(id: string, name: string): void {
            const state = arrangementStore.value;
            if (!state) {
                return;
            }

            arrangementStore.set({
                ...state,
                arrangements: state.arrangements.map((a) => (a.id === id ? { ...a, name } : a)),
            });
            markDirty();
        }
);
