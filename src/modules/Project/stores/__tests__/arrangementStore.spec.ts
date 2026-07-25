import { describe, expect, it, vi } from 'vitest';

import { createStore } from '#/infra/store/createStore';

// arrangementStore is the CRDT-backed store hydrated by projectCrdtToStores().
// Without a `sanitize` guard on createStore, a corrupt/malformed persisted doc
// value hydrates RAW into live state (the present-but-invalid blob hazard).
// This spec captures the createStore options the store module passes and
// proves the hydration guard is wired and repairs corrupt payloads.
vi.mock('#/infra/store/createStore', () => ({
    createStore: vi.fn(() => ({
        value: null,
        set: vi.fn(),
        update: vi.fn(),
        clear: vi.fn(),
        hydrate: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        subscribeReact: vi.fn(() => () => {}),
    })),
}));

vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    createAutomergeStorage: vi.fn(() => ({
        isSupported: () => true,
        get: () => null,
        set: vi.fn(),
        clear: vi.fn(),
    })),
}));

import {
    defaultArrangementId,
    defaultArrangementStoreState,
    sanitize_arrangement_store_state,
    type ArrangementSnapshot,
} from '../arrangementStore';

type CapturedStoreOptions = {
    sanitize?: (value: unknown) => unknown;
};

function getArrangementStoreOptions(): CapturedStoreOptions {
    const calls = vi.mocked(createStore).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    return calls[0]![0] as CapturedStoreOptions;
}

describe('arrangementStore hydration guard', () => {
    it('wires a sanitize guard into createStore so hydrated CRDT blobs cannot reach state raw', () => {
        const options = getArrangementStoreOptions();
        // Pre-guard this was undefined: hydrate() passed the persisted doc value
        // straight into live state with no validation between doc and store.
        expect(typeof options.sanitize).toBe('function');
    });

    it('repairs a present-but-invalid persisted blob to the default state instead of hydrating it raw', () => {
        const options = getArrangementStoreOptions();
        const corrupt = { arrangements: 'junk', activeArrangementId: 42 };

        const sanitized = options.sanitize?.(corrupt);

        expect(sanitized).toEqual({
            arrangements: defaultArrangementStoreState.arrangements,
            activeArrangementId: defaultArrangementStoreState.activeArrangementId,
        });
    });
});

function createValidSnapshot(id: string): ArrangementSnapshot {
    return {
        id,
        name: `Arrangement ${id}`,
        tracks: { tracks: [], selectedTrackId: null },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
    };
}

describe('sanitize_arrangement_store_state', () => {
    it('should reset non-object persisted arrangement state', () => {
        expect(sanitize_arrangement_store_state('corrupt')).toEqual(defaultArrangementStoreState);
        expect(sanitize_arrangement_store_state(null)).toEqual(defaultArrangementStoreState);
        expect(sanitize_arrangement_store_state([])).toEqual(defaultArrangementStoreState);
    });

    it('should return an exact valid state unchanged (same reference)', () => {
        const valid = {
            arrangements: [createValidSnapshot('alpha-1')],
            activeArrangementId: 'alpha-1',
        };

        expect(sanitize_arrangement_store_state(valid)).toBe(valid);
    });

    it('strips a retired virginTerritory key off automation lanes arriving from an older peer', () => {
        // The sync path, not the file path. A peer still running a build from
        // before `virginTerritory` was removed puts a lane that still carries it
        // into an arrangement snapshot and writes that to the CRDT slot. This
        // store validates lanes structurally and shallowly — an identified row
        // counted as "exact" whatever extra fields it carried — so the field
        // survived here for any arrangement that is not the active one (only the
        // active arrangement is routed through automationStore's deep
        // sanitizer). buildProjectData then shallow-spreads the snapshot and the
        // saved .sourdaw writes the dead field straight back out: the same
        // field-lives-forever failure the file import path strips, arriving over
        // sync instead.
        const snapshot = createValidSnapshot('alpha-1');
        const withRetiredKey = {
            ...snapshot,
            automation: {
                lanes: [
                    {
                        id: 'lane-1',
                        trackId: 'track-1',
                        parameterId: 'gain',
                        parameterName: 'Gain',
                        points: [],
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        virginTerritory: true,
                        minValue: 0,
                        maxValue: 1,
                    },
                ],
            },
        };

        const sanitized = sanitize_arrangement_store_state({
            arrangements: [withRetiredKey],
            activeArrangementId: 'alpha-1',
        });

        const lane = sanitized.arrangements[0]?.automation.lanes[0];
        expect(lane).not.toHaveProperty('virginTerritory');
        // The rest of the lane must survive intact — this strips one retired
        // key, it does not drop or rebuild the lane.
        expect(lane).toMatchObject({ id: 'lane-1', parameterId: 'gain', enabled: true, maxValue: 1 });
    });

    // The strip must stay surgical. Rebuilding every snapshot and every lane on
    // each hydrate would also pass a key-absence assertion, while turning this
    // sanitizer into an unconditional deep copy of the whole project on every
    // CRDT change — a real cost on large projects. The property that prevents
    // that is reference preservation: anything already clean comes back as the
    // very same object. These cases pin it at both levels.
    function laneCarryingRetiredKey(id: string) {
        return {
            id,
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            virginTerritory: true,
            minValue: 0,
            maxValue: 1,
        };
    }

    function cleanLane(id: string) {
        const lane = laneCarryingRetiredKey(id);
        Reflect.deleteProperty(lane, 'virginTerritory');
        return lane;
    }

    it('rebuilds only the arrangement whose lane is dirty, returning clean siblings by reference', () => {
        const clean = createValidSnapshot('clean-1');
        const dirty = {
            ...createValidSnapshot('dirty-1'),
            automation: { lanes: [laneCarryingRetiredKey('lane-dirty')] },
        };

        const sanitized = sanitize_arrangement_store_state({
            arrangements: [clean, dirty],
            activeArrangementId: 'clean-1',
        });

        // Untouched arrangement: same object, not a copy.
        expect(sanitized.arrangements[0]).toBe(clean);
        // Dirty arrangement: rebuilt, and the retired key is gone.
        expect(sanitized.arrangements[1]).not.toBe(dirty);
        expect(sanitized.arrangements[1]?.automation.lanes[0]).not.toHaveProperty('virginTerritory');
    });

    it('rebuilds only the dirty lane within an arrangement, returning clean lanes by reference', () => {
        const untouched = cleanLane('lane-clean');
        const dirty = laneCarryingRetiredKey('lane-dirty');
        const snapshot = {
            ...createValidSnapshot('alpha-1'),
            automation: { lanes: [untouched, dirty] },
        };

        const sanitized = sanitize_arrangement_store_state({
            arrangements: [snapshot],
            activeArrangementId: 'alpha-1',
        });

        const lanes = sanitized.arrangements[0]?.automation.lanes;
        expect(lanes?.[0]).toBe(untouched);
        expect(lanes?.[1]).not.toBe(dirty);
        expect(lanes?.[1]).not.toHaveProperty('virginTerritory');
        // The dirty lane keeps every field except the retired one.
        expect(lanes?.[1]).toEqual(cleanLane('lane-dirty'));
    });

    it('is idempotent: sanitizing an already-sanitized state changes nothing further', () => {
        const dirtyState = {
            arrangements: [
                {
                    ...createValidSnapshot('alpha-1'),
                    automation: { lanes: [laneCarryingRetiredKey('lane-dirty')] },
                },
            ],
            activeArrangementId: 'alpha-1',
        };

        const first = sanitize_arrangement_store_state(dirtyState);
        const second = sanitize_arrangement_store_state(first);

        expect(second).toEqual(first);
        // The second pass recognises the cleaned state as already exact and
        // hands back the identical object rather than rebuilding it again.
        expect(second).toBe(first);
    });

    it('should preserve valid snapshots while dropping malformed entries', () => {
        const valid = createValidSnapshot('alpha-1');

        expect(
            sanitize_arrangement_store_state({
                arrangements: [
                    valid,
                    'corrupt',
                    { id: 42, name: 'No string id' },
                    { id: 'no-sections', name: 'Missing required sections' },
                    { ...createValidSnapshot('bad-tracks'), tracks: 'corrupt' },
                ],
                activeArrangementId: 'alpha-1',
            })
        ).toEqual({ arrangements: [valid], activeArrangementId: 'alpha-1' });
    });

    it('should default invalid top-level fields', () => {
        const valid = createValidSnapshot('alpha-1');

        expect(sanitize_arrangement_store_state({ arrangements: [valid], activeArrangementId: 42 })).toEqual({
            arrangements: [valid],
            activeArrangementId: defaultArrangementId,
        });

        expect(sanitize_arrangement_store_state({ arrangements: 'corrupt', activeArrangementId: 'alpha-1' })).toEqual({
            arrangements: defaultArrangementStoreState.arrangements,
            activeArrangementId: 'alpha-1',
        });
    });

    it('should drop malformed rows inside snapshot sections and repair the selection', () => {
        const midiNote = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };

        expect(
            sanitize_arrangement_store_state({
                arrangements: [
                    {
                        ...createValidSnapshot('alpha-1'),
                        tracks: { tracks: [{ id: 'track-1' }, 'corrupt', { id: 42 }], selectedTrackId: 42 },
                        midi: {
                            notesByClipId: { 'clip-1': [midiNote, 'corrupt'], 'clip-2': 'corrupt' },
                            ccByClipId: {},
                            pitchBendByClipId: {},
                        },
                    },
                ],
                activeArrangementId: 'alpha-1',
            })
        ).toEqual({
            arrangements: [
                {
                    ...createValidSnapshot('alpha-1'),
                    tracks: {
                        // A minimal identified row is repaired with the structural
                        // defaults buildProjectData() dereferences on EVERY
                        // arrangement (including inactive ones): clips array, a
                        // freezeState object, and the canonical ≥1-alternative
                        // invariant (deterministic `${id}-alt-default`, mirroring
                        // normalizeTrack()/hydrateTrack()).
                        tracks: [
                            {
                                id: 'track-1',
                                clips: [],
                                alternatives: [{ id: 'track-1-alt-default', name: 'Alternative 1', clips: [] }],
                                activeAlternativeId: 'track-1-alt-default',
                                freezeState: { status: 'unfrozen' },
                            },
                        ],
                        selectedTrackId: null,
                    },
                    midi: {
                        notesByClipId: { 'clip-1': [midiNote] },
                        ccByClipId: {},
                        pitchBendByClipId: {},
                    },
                },
            ],
            activeArrangementId: 'alpha-1',
        });
    });

    it('should drop invalid optional sections and keep valid ones', () => {
        const tempoChange = { id: 'tempo-1', beat: 0, tempo: 120, curve: 'instant' };

        expect(
            sanitize_arrangement_store_state({
                arrangements: [
                    {
                        ...createValidSnapshot('alpha-1'),
                        tempoMap: { changes: [tempoChange] },
                        markers: 'corrupt',
                    },
                ],
                activeArrangementId: 'alpha-1',
            })
        ).toEqual({
            arrangements: [{ ...createValidSnapshot('alpha-1'), tempoMap: { changes: [tempoChange] } }],
            activeArrangementId: 'alpha-1',
        });
    });

    it('should strip unknown fields from the state and snapshots', () => {
        const valid = createValidSnapshot('alpha-1');

        expect(
            sanitize_arrangement_store_state({
                arrangements: [{ ...valid, stale: true }],
                activeArrangementId: 'alpha-1',
                stale: true,
            })
        ).toEqual({ arrangements: [valid], activeArrangementId: 'alpha-1' });
    });

    it('repairs track rows so save/export structural invariants hold (clips/alternatives arrays, freezeState object)', () => {
        const sanitized = sanitize_arrangement_store_state({
            arrangements: [
                {
                    ...createValidSnapshot('alpha-1'),
                    tracks: {
                        tracks: [
                            { id: 'bare' },
                            { id: 'bad-shapes', clips: 'corrupt', alternatives: 'corrupt', freezeState: 'corrupt' },
                            {
                                id: 'bad-alt-clips',
                                clips: [{ id: 'clip-1' }],
                                alternatives: [{ id: 'alt-1' }, 'corrupt'],
                                freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
                            },
                        ],
                        selectedTrackId: null,
                    },
                },
            ],
            activeArrangementId: 'alpha-1',
        });

        expect(sanitized.arrangements[0]!.tracks.tracks).toEqual([
            {
                id: 'bare',
                clips: [],
                alternatives: [{ id: 'bare-alt-default', name: 'Alternative 1', clips: [] }],
                activeAlternativeId: 'bare-alt-default',
                freezeState: { status: 'unfrozen' },
            },
            {
                id: 'bad-shapes',
                clips: [],
                alternatives: [{ id: 'bad-shapes-alt-default', name: 'Alternative 1', clips: [] }],
                activeAlternativeId: 'bad-shapes-alt-default',
                freezeState: { status: 'unfrozen' },
            },
            {
                id: 'bad-alt-clips',
                clips: [{ id: 'clip-1' }],
                alternatives: [{ id: 'alt-1', clips: [] }],
                activeAlternativeId: 'alt-1',
                freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
            },
        ]);
    });

    it('repairs empty or dangling alternatives to the canonical ≥1-alternative invariant', () => {
        const sanitized = sanitize_arrangement_store_state({
            arrangements: [
                {
                    ...createValidSnapshot('alpha-1'),
                    tracks: {
                        tracks: [
                            // Present-but-empty alternatives array: `??` in the
                            // canonical constructors will not heal this, so the
                            // sanitizer must.
                            {
                                id: 'empty-alts',
                                clips: [],
                                alternatives: [],
                                freezeState: { status: 'unfrozen' },
                            },
                            // Dangling activeAlternativeId: repointed at the first
                            // surviving alternative.
                            {
                                id: 'dangling-active',
                                clips: [],
                                alternatives: ['corrupt', { id: 'alt-real', name: 'Alt', clips: [] }],
                                activeAlternativeId: 'alt-gone',
                                freezeState: { status: 'unfrozen' },
                            },
                        ],
                        selectedTrackId: null,
                    },
                },
            ],
            activeArrangementId: 'alpha-1',
        });

        const [emptyAlts, danglingActive] = sanitized.arrangements[0]!.tracks.tracks;

        // Exactly one canonical default alternative, and the active id points at it.
        expect(emptyAlts!.alternatives).toEqual([{ id: 'empty-alts-alt-default', name: 'Alternative 1', clips: [] }]);
        expect(emptyAlts!.activeAlternativeId).toBe('empty-alts-alt-default');

        expect(danglingActive!.alternatives).toEqual([{ id: 'alt-real', name: 'Alt', clips: [] }]);
        expect(danglingActive!.activeAlternativeId).toBe('alt-real');
    });

    it('never throws on adversarial shapes: null rows, arrays where objects expected, prototype-pollution keys', () => {
        // Null elements inside every row collection are dropped, not thrown on.
        const withNulls = sanitize_arrangement_store_state({
            arrangements: [
                null,
                {
                    ...createValidSnapshot('alpha-1'),
                    tracks: { tracks: [null, { id: 'track-1' }], selectedTrackId: null },
                    automation: { lanes: [null] },
                    midi: { notesByClipId: { 'clip-1': [null] }, ccByClipId: {}, pitchBendByClipId: {} },
                    markers: { markers: [null], sections: [null] },
                },
            ],
            activeArrangementId: 'alpha-1',
        });
        expect(withNulls.arrangements).toHaveLength(1);
        expect(withNulls.arrangements[0]!.tracks.tracks.map((track) => track.id)).toEqual(['track-1']);
        expect(withNulls.arrangements[0]!.automation.lanes).toEqual([]);
        expect(withNulls.arrangements[0]!.midi.notesByClipId).toEqual({ 'clip-1': [] });
        expect(withNulls.arrangements[0]!.markers).toEqual({ markers: [], sections: [] });

        // Arrays where objects are expected are rejected, not dereferenced.
        const withArrays = sanitize_arrangement_store_state({
            arrangements: [
                { ...createValidSnapshot('alpha-1'), midi: [] },
                { ...createValidSnapshot('beta-2'), tracks: [] },
            ],
            activeArrangementId: [],
        });
        expect(withArrays.arrangements).toEqual([]);
        expect(withArrays.activeArrangementId).toBe(defaultArrangementId);

        // Prototype-pollution-style keys survive as plain data without polluting
        // Object.prototype (JSON.parse produces an own __proto__ property).
        const polluted = sanitize_arrangement_store_state(
            JSON.parse('{"arrangements": [], "activeArrangementId": "alpha-1", "__proto__": {"polluted": true}}')
        );
        expect(polluted.arrangements).toEqual([]);
        expect(polluted.activeArrangementId).toBe('alpha-1');
        expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });
});
