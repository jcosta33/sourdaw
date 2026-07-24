import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { kneadStore, type KneadClipState } from '#/modules/Knead/stores';
import { transportStore } from '#/modules/Transport/stores';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { actionHistoryStore } from '../../../stores/actionHistoryStore';
import { registerCrdtStorageRuntime } from '../../registerCrdtStorageRuntime';
import { projectSlotProjections } from '../projectProjection';
import { setupProjectionBridge } from '../setupProjectionBridge';

/**
 * Audit CC-1 — projection cost must be proportional to what changed.
 *
 * Before this lane every CRDT mutation — local knob sweeps included — ran a
 * full re-projection of every root slot, and each slot's `hydrate()` paid a
 * `JSON.stringify` of its whole doc slot before it could tell whether anything
 * had changed. This spec measures the counter that made that expensive: store
 * `hydrate()` dispatches per change.
 */

type ProjectionCounters = {
    hydrateCalls: number;
};

function createClipFixture(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-knead',
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function createTrackFixture(overrides: Partial<Track> = {}): Track {
    return {
        id: 'track-knead',
        name: 'Knead Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

const kneadClipState: KneadClipState = {
    clipId: 'clip-knead',
    blobs: [],
    retuneSpeedMs: 25,
    toleranceCents: 25,
    toleranceTimeMs: 30,
    humanizePercent: 40,
    formantPreserve: true,
};

describe('projection cost per CRDT change (audit CC-1)', () => {
    let teardownBridge: (() => void) | null = null;
    let hydrateSpies: MockInstance[] = [];

    beforeAll(() => {
        registerCrdtStorageRuntime();
    });

    afterAll(() => {
        automergeRepository.reset();
    });

    beforeEach(() => {
        automergeRepository.createProject('cost-measurement');
        // Drain the deferred writes each store seeded at module init so the
        // measured window contains only the change under test.
        flushAutomergeStorageWrites();
        teardownBridge = setupProjectionBridge();
    });

    afterEach(() => {
        for (const spy of hydrateSpies) {
            spy.mockRestore();
        }
        hydrateSpies = [];
        teardownBridge?.();
        teardownBridge = null;
        flushAutomergeStorageWrites();
    });

    function measure(change: () => void): ProjectionCounters {
        const counters: ProjectionCounters = { hydrateCalls: 0 };
        for (const projection of projectSlotProjections) {
            const spy = vi.spyOn(projection.store, 'hydrate');
            spy.mockImplementation(() => {
                counters.hydrateCalls += 1;
            });
            hydrateSpies.push(spy);
        }

        change();
        flushAutomergeStorageWrites();
        return counters;
    }

    function measureStringify(change: () => void): number {
        let stringifyCalls = 0;
        const originalStringify = JSON.stringify.bind(JSON);
        const spy = vi.spyOn(JSON, 'stringify');
        spy.mockImplementation((...args: Parameters<typeof JSON.stringify>) => {
            stringifyCalls += 1;
            return originalStringify(...args);
        });
        try {
            change();
            flushAutomergeStorageWrites();
        } finally {
            spy.mockRestore();
        }
        return stringifyCalls;
    }

    it('serializes fewer slots for a local write than for a full re-projection', () => {
        const transport = transportStore.value;
        if (!transport) {
            throw new Error('transportStore must hold its seeded default');
        }

        const localWriteCost = measureStringify(() => {
            transportStore.set({ ...transport, tempo: 118 });
        });
        const fullProjectionCost = measureStringify(() => {
            automergeRepository.changeDoc<Record<string, unknown>>('root', (doc) => {
                doc.externalSlot = { touched: true };
            });
        });

        // Measured on this harness: 1 serialization for the local write (its
        // own `toDocSafe` round-trip) against 49 for the full re-projection —
        // which is what every local write used to pay, and grows with the
        // project because each slot serializes its whole payload.
        expect(localWriteCost).toBe(1);
        expect(fullProjectionCost).toBeGreaterThanOrEqual(projectSlotProjections.length);
    });

    it('dispatches no slot re-projection for a local single-slot write', () => {
        const transport = transportStore.value;
        if (!transport) {
            throw new Error('transportStore must hold its seeded default');
        }

        const counters = measure(() => {
            transportStore.set({ ...transport, tempo: 132 });
        });

        // The adapter that performed the write already holds the truth for its
        // own slot, and no other slot's projection depends on `transport`.
        expect(counters.hydrateCalls).toBe(0);
        expect(transportStore.value?.tempo).toBe(132);
    });

    it('dispatches no slot re-projection for the post-commit action-history write', () => {
        const counters = measure(() => {
            actionHistoryStore.set({
                entries: [
                    {
                        id: 'entry-1',
                        label: 'Add track',
                        actionKind: 'track/add',
                        source: 'manual',
                        timestamp: 1,
                        reverted: false,
                    },
                ],
            });
        });

        expect(counters.hydrateCalls).toBe(0);
    });

    it('still runs projections derived from another slot on a local write', () => {
        const track = createTrackFixture({
            clips: [createClipFixture({ id: 'clip-knead', kneadState: kneadClipState })],
        });

        trackStore.set({ tracks: [track], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();

        // `knead` is projected from trackStore clip state, so a local `tracks`
        // write must still refresh it even though `tracks` itself is skipped.
        expect(kneadStore.value?.clips['clip-knead']).toEqual(kneadClipState);
    });

    it('re-projects every slot for a document-origin change with no slot hint', () => {
        // A merged/synced document does not report which keys moved, so the
        // full pass stays the correct answer there.
        const ownSlotProjections = projectSlotProjections.filter(
            (projection) => !projection.derivedFromSiblingSlot
        ).length;

        const counters = measure(() => {
            automergeRepository.changeDoc<Record<string, unknown>>('root', (doc) => {
                doc.externalSlot = { touched: true };
            });
        });

        expect(ownSlotProjections).toBeGreaterThan(1);
        expect(counters.hydrateCalls).toBe(ownSlotProjections);
    });
});
