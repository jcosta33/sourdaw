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
                    tracks: { tracks: [{ id: 'track-1' }], selectedTrackId: null },
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
});
