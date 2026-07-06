import { clearUndoHistory } from '#/modules/Command/useCases';

import { arrangementStore } from '../../stores/arrangementStore';
import { type ArrangementSnapshot } from '../../stores/arrangementStore';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

import { loadSnapshot } from './loadSnapshot';
import { syncCurrentArrangementToStore } from './syncCurrentArrangementToStore';

export function createArrangement(name: string): void {
    const state = arrangementStore.value;
    if (!state) {
        return;
    }

    const id = `arr-${crypto.randomUUID()}`;

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
