import { beforeEach, describe, expect, it, vi } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores';

import {
    arrangementStore,
    defaultArrangementStoreState,
    type ArrangementSnapshot,
} from '../../../../stores/arrangementStore';
import { hydrateArrangementStoreFromProjectData } from '../../helpers/hydrateArrangementStoreFromProjectData';
import { isHydratableProjectData } from '../../helpers/isHydratableProjectData';
import { buildProjectData } from '../buildProjectData';

vi.mock('../../../arrangement/syncCurrentArrangementToStore', () => ({
    syncCurrentArrangementToStore: vi.fn(),
}));

function arrangementSnapshot(id: string, name: string): ArrangementSnapshot {
    return {
        id,
        name,
        tracks: { tracks: [], selectedTrackId: null },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
    };
}

/**
 * The coordinate stamp's write side and its JSON hydration ride-along must
 * agree (#4601): a stamp captured into the stores and serialized into project
 * truth has to come back out of a reopen, or the arrangement-switch restore
 * leaves an unstamped store and the legacy migration rewrites notes
 * clip-relative data must never touch. This drives the same sequence a
 * named-project reopen runs: real stores, a real build, a JSON round-trip,
 * and the real hydrator.
 */
describe('noteCoordinateFormat across a named-project reopen', () => {
    beforeEach(() => {
        midiStore.set(null);
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
    });

    it('restores the stamp into the arrangement snapshots and the live MIDI store', async () => {
        midiStore.set({
            probabilitySeed: 0xdecafbad,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
            noteCoordinateFormat: 'clip-relative',
        });
        arrangementStore.set({
            arrangements: [
                {
                    ...arrangementSnapshot('arrangement-stamped', 'Stamped'),
                    midi: {
                        notesByClipId: {},
                        ccByClipId: {},
                        pitchBendByClipId: {},
                        noteCoordinateFormat: 'clip-relative',
                    },
                },
                arrangementSnapshot('arrangement-legacy', 'Legacy'),
            ],
            activeArrangementId: 'arrangement-stamped',
        });

        const built = await buildProjectData();
        if (!built) {
            throw new Error('expected buildProjectData to produce a snapshot');
        }
        // Precondition, not the subject: the built document carries the stamps
        // the serialization leg pins in buildProjectData.spec.ts. A failure on
        // these two lines belongs to that leg, not to the hydrator.
        expect(built.data.midi.noteCoordinateFormat).toBe('clip-relative');
        const stampedSnapshot = built.data.arrangements?.find(
            (arrangement) => arrangement.id === 'arrangement-stamped'
        );
        expect(stampedSnapshot?.midi).toHaveProperty('noteCoordinateFormat', 'clip-relative');

        const onDisk: unknown = structuredClone(built.data);
        if (!isHydratableProjectData(onDisk)) {
            throw new Error('the snapshot this build just wrote was rejected by its own import validator');
        }

        hydrateArrangementStoreFromProjectData({ data: onDisk, preserveSavedArrangements: true });

        const arrangements = arrangementStore.value?.arrangements ?? [];
        expect(arrangements.find((snapshot) => snapshot.id === 'arrangement-stamped')?.midi).toHaveProperty(
            'noteCoordinateFormat',
            'clip-relative'
        );
        expect(arrangements.find((snapshot) => snapshot.id === 'arrangement-legacy')?.midi).not.toHaveProperty(
            'noteCoordinateFormat'
        );
        expect(midiStore.value?.noteCoordinateFormat).toBe('clip-relative');
    });
});
