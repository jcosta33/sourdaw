import { beforeEach, describe, expect, it } from 'vitest';

import {
    createAutomergeStorage,
    findAutomergeStorageRawProjectionLosses,
} from '#/infra/store/storage/createAutomergeStorage';

import {
    defaultArrangementId,
    sanitize_arrangement_store_state,
    type ArrangementSnapshot,
    type ArrangementStoreState,
    type ProjectMidiState,
} from '../arrangementStore';

/**
 * `syncArrangement` embeds the live `midiStore.value` wholesale into
 * `arrangements[0].midi`, so the raw CRDT slot carries `probabilitySeed` — a
 * durable field of the MIDI store. The sanitizer must preserve that seed or
 * the raw projection-loss detector reports the `arrangements` slot, arms
 * repair-required, and refuses every project mutation, save, and creation.
 */

/** A uint32 the live MIDI store can hold (observed on a pristine boot). */
const VALID_SEED = 2831361853;
/** An integer the live store's seed validator rejects. */
const INVALID_SEED = -1;

function createMidiSection(probabilitySeed?: number): ProjectMidiState {
    const section: ProjectMidiState = {
        notesByClipId: { 'clip-1': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        ccByClipId: {},
        pitchBendByClipId: {},
    };
    return probabilitySeed === undefined ? section : { ...section, probabilitySeed };
}

function createState(midi: ProjectMidiState): ArrangementStoreState {
    const snapshot: ArrangementSnapshot = {
        id: defaultArrangementId,
        name: 'Arrangement 1',
        tracks: { tracks: [], selectedTrackId: null },
        automation: { lanes: [] },
        midi,
    };
    return { arrangements: [snapshot], activeArrangementId: defaultArrangementId };
}

/** Registers the arrangements slot exactly as the store module's createStore
 * call does: same doc id, slot, and inbound sanitizer, with no fromCrdt. */
function registerArrangementsSanitizer(): void {
    createAutomergeStorage<ArrangementStoreState>('root', 'arrangements').registerInboundSanitizer?.(
        sanitize_arrangement_store_state
    );
}

function findArrangementLosses(state: ArrangementStoreState): string[] {
    return findAutomergeStorageRawProjectionLosses({ docId: 'root', document: { arrangements: state } });
}

describe('arrangement midi probabilitySeed raw projection loss', () => {
    beforeEach(() => {
        registerArrangementsSanitizer();
    });

    it('sanitizes a midi section carrying a valid seed as exact, preserving the seed', () => {
        const state = createState(createMidiSection(VALID_SEED));

        const sanitized = sanitize_arrangement_store_state(state);

        // Exact-shape acceptance: the state passes through unrebuilt.
        expect(sanitized).toBe(state);
        expect(sanitized.arrangements[0]?.midi.probabilitySeed).toBe(VALID_SEED);
    });

    it('preserves a valid seed through the normalize path when the snapshot is rebuilt for another reason', () => {
        // A snapshot this build does not recognize as exact — here an unknown
        // key, in production any field a newer peer writes — is rebuilt
        // section by section; the rebuild must keep the seed or such a
        // document locks the project out exactly like the incident did.
        const snapshot = { ...createState(createMidiSection(VALID_SEED)).arrangements[0]!, stale: true };

        const sanitized = sanitize_arrangement_store_state({
            arrangements: [snapshot],
            activeArrangementId: defaultArrangementId,
        });

        expect(sanitized.arrangements[0]?.midi.probabilitySeed).toBe(VALID_SEED);
        expect(sanitized.arrangements[0]).not.toHaveProperty('stale');
    });

    it('reports no raw projection loss for an arrangements slot embedding a valid seed', () => {
        expect(findArrangementLosses(createState(createMidiSection(VALID_SEED)))).toEqual([]);
    });

    it('sanitizes a seed-less midi section without introducing a seed key', () => {
        const sanitized = sanitize_arrangement_store_state(createState(createMidiSection()));

        expect(sanitized.arrangements[0]?.midi).toEqual(createMidiSection());
        expect(sanitized.arrangements[0]?.midi).not.toHaveProperty('probabilitySeed');
    });

    it('drops an invalid seed during sanitize: content this build cannot read', () => {
        const sanitized = sanitize_arrangement_store_state(createState(createMidiSection(INVALID_SEED)));

        expect(sanitized.arrangements[0]?.midi).toEqual(createMidiSection());
        expect(sanitized.arrangements[0]?.midi).not.toHaveProperty('probabilitySeed');
    });

    it('reports an invalid seed as a loss: unreadable content is intended detector behavior', () => {
        expect(findArrangementLosses(createState(createMidiSection(INVALID_SEED)))).toEqual(['arrangements']);
    });
});
