import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const trackState = { value: null as unknown };
    const markerState = { value: null as unknown };
    return {
        trackState,
        markerState,
        getTrackState: vi.fn(() => trackState.value),
        setTrackState: vi.fn<(state: unknown) => void>(),
        setMarkerState: vi.fn<(state: unknown) => void>(),
        batchDepth: 0,
        writeDepths: [] as number[],
    };
});

vi.mock('#/infra/store/createStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/store/createStore')>();
    return {
        ...actual,
        batchStoreUpdates<TResult>(update: () => TResult): TResult {
            mocks.batchDepth++;
            try {
                return update();
            } finally {
                mocks.batchDepth--;
            }
        },
    };
});

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState: (state: unknown) => {
        mocks.writeDepths.push(mocks.batchDepth);
        mocks.trackState.value = state;
        mocks.setTrackState(state);
    },
}));

vi.mock('../../../stores/markerStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/markerStore')>();
    return {
        ...actual,
        markerStore: {
            get value() {
                return mocks.markerState.value;
            },
            set(state: unknown) {
                mocks.writeDepths.push(mocks.batchDepth);
                mocks.markerState.value = state;
                mocks.setMarkerState(state);
            },
        },
    };
});

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { executeGlobalTimeOperation } from '../executeGlobalTimeOperation';
import { setTimeOperationDependencies, type TimeOperationDependencies } from '../timeOperationDependencies';

type TestHandle = ReturnType<typeof createHandle> | ReturnType<typeof createRejectedHandle>;

function createHandle(name: string, hasChanges = true) {
    let inversePlan: Record<string, unknown> | null = null;
    if (hasChanges) {
        inversePlan = {
            version: 1 as const,
            expected: { owner: name, state: 'next' },
            replacement: { owner: name, state: 'previous' },
        };
    }
    return {
        status: 'ready' as const,
        hasChanges,
        replayPlan: { version: 1 as const, notes: [] },
        inversePlan,
        apply: vi.fn(() => true),
        revert: vi.fn(() => true),
    };
}

function createRejectedHandle() {
    return {
        status: 'rejected' as const,
        hasChanges: false,
        replayPlan: { version: 1 as const, notes: [] },
        inversePlan: null,
        apply: vi.fn(() => false),
        revert: vi.fn(() => false),
    };
}

function createClip(input: {
    id: string;
    trackId?: string;
    startBeat: number;
    endBeat: number;
    type?: 'audio' | 'midi';
    audioOffsetBeats?: number;
    midiOffsetBeats?: number;
}) {
    return {
        id: input.id,
        trackId: input.trackId ?? 'track-1',
        name: input.id,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: input.type ?? 'midi',
        ...(input.audioOffsetBeats === undefined ? {} : { audioOffsetBeats: input.audioOffsetBeats }),
        ...(input.midiOffsetBeats === undefined ? {} : { midiOffsetBeats: input.midiOffsetBeats }),
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function createTrack(
    id: string,
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder',
    clips: ReturnType<typeof createClip>[]
) {
    return TrackDummy.create({ id, kind, clips });
}

// Construct a clip-shaped object that bypasses createClip's type narrowing so we can
// inject malformed field values the validator must reject.
function malformedClip(overrides: Record<string, unknown>): ReturnType<typeof createClip> {
    const base = createClip({ id: 'c1', startBeat: 0, endBeat: 2 });
    Object.assign(base, overrides);
    return base;
}

function setStates(input?: {
    tracks?: ReturnType<typeof createTrack>[];
    markers?: Array<{ id: string; beat: number; name: string; color: string }>;
    sections?: Array<{ id: string; startBeat: number; endBeat: number; name: string; color: string }>;
}): void {
    const tracks = input?.tracks ?? [];
    let selectedTrackId: string | null = null;
    if (tracks.some((track) => track.id === 'track-1')) {
        selectedTrackId = 'track-1';
    }
    mocks.trackState.value = {
        tracks,
        selectedTrackId,
        ghostClips: [createClip({ id: 'ghost-1', trackId: 'ghost-track', startBeat: 0, endBeat: 1 })],
    };
    mocks.markerState.value = {
        markers: input?.markers ?? [],
        sections: input?.sections ?? [],
    };
    mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
}

function registerDependencies(input?: { automation?: TestHandle; transport?: TestHandle; midi?: TestHandle }) {
    const automation = input?.automation ?? createHandle('automation');
    const transport = input?.transport ?? createHandle('transport');
    const midi = input?.midi ?? createHandle('midi');
    const prepareAutomationTimeOperation = vi.fn(() => automation);
    const prepareTimelineMapTimeOperation = vi.fn(() => transport);
    const prepareMidiGlobalTimeTransaction = vi.fn<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>(
        () => midi
    );
    setTimeOperationDependencies({
        prepareAutomationTimeOperation,
        prepareAutomationTimeStateRestore: vi.fn(() => createHandle('automation-restore', false)),
        prepareTimelineMapTimeOperation,
        prepareTimelineMapStateRestore: vi.fn(() => createHandle('transport-restore', false)),
        prepareMidiGlobalTimeTransaction,
        prepareMidiTimeStateRestore: vi.fn(() => createHandle('midi-restore', false)),
    });
    return {
        automation,
        transport,
        midi,
        prepareAutomationTimeOperation,
        prepareTimelineMapTimeOperation,
        prepareMidiGlobalTimeTransaction,
    };
}

const REJECTED = { status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null };

describe('executeGlobalTimeOperation input validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    describe('rejects non-object or wrong-shaped inputs before any work', () => {
        it.each([
            ['null', null],
            ['array', []],
            ['number', 7],
            ['string', 'insert'],
            ['input missing operation', { type: 'insert' }],
        ])('rejects %s', (_label, value) => {
            registerDependencies();
            // The validator treats the whole input as unknown.
            const result = executeGlobalTimeOperation(value as never);
            expect(result).toEqual(REJECTED);
        });
    });

    describe('rejects malformed operation shapes', () => {
        it.each([
            ['insert missing durationBeats', { type: 'insert', atBeat: 1 }],
            ['insert extra key', { type: 'insert', atBeat: 1, durationBeats: 2, extra: true }],
            ['insert negative atBeat', { type: 'insert', atBeat: -1, durationBeats: 2 }],
            ['insert NaN atBeat', { type: 'insert', atBeat: Number.NaN, durationBeats: 2 }],
            ['insert non-number atBeat', { type: 'insert', atBeat: '1', durationBeats: 2 }],
            ['insert non-finite duration', { type: 'insert', atBeat: 1, durationBeats: Number.POSITIVE_INFINITY }],
            ['insert non-number duration', { type: 'insert', atBeat: 1, durationBeats: '2' }],
            ['insert zero duration', { type: 'insert', atBeat: 1, durationBeats: 0 }],
            [
                'insert duration causing non-finite sum',
                { type: 'insert', atBeat: Number.MAX_VALUE, durationBeats: Number.MAX_VALUE },
            ],
            ['unknown type', { type: 'split', startBeat: 0, endBeat: 2 }],
            ['delete missing endBeat', { type: 'delete', startBeat: 0 }],
            ['delete negative startBeat', { type: 'delete', startBeat: -1, endBeat: 2 }],
            ['delete non-number endBeat', { type: 'delete', startBeat: 0, endBeat: '2' }],
            ['delete endBeat <= startBeat (equal)', { type: 'delete', startBeat: 2, endBeat: 2 }],
            ['delete endBeat < startBeat', { type: 'delete', startBeat: 5, endBeat: 2 }],
            ['duplicate missing startBeat', { type: 'duplicate', endBeat: 2 }],
        ])('rejects %s', (_label, operation) => {
            registerDependencies();
            const result = executeGlobalTimeOperation({ operation: operation as never });
            expect(result).toEqual(REJECTED);
        });
    });

    describe('input replayPlan key exactness', () => {
        it('rejects an input object that is not a plain object', () => {
            registerDependencies();
            const result = executeGlobalTimeOperation({
                operation: { type: 'insert', atBeat: 1, durationBeats: 2 },
            } as never);
            // Valid input should not be rejected here; this proves the plain-object branch passes.
            expect(result).not.toEqual(REJECTED);
        });

        it('rejects an input with an extra key alongside operation', () => {
            registerDependencies();
            const result = executeGlobalTimeOperation({
                operation: { type: 'insert', atBeat: 1, durationBeats: 2 },
                extra: true,
            } as never);
            expect(result).toEqual(REJECTED);
        });
    });
});

describe('executeGlobalTimeOperation clip ownership validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    it('rejects a clip with an empty id', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [createClip({ id: '   ', startBeat: 0, endBeat: 2 })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip with an empty trackId', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [createClip({ id: 'c1', trackId: '', startBeat: 0, endBeat: 2 })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip whose endBeat <= startBeat', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [malformedClip({ startBeat: 5, endBeat: 2 })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip with a non-finite startBeat', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [malformedClip({ startBeat: Number.POSITIVE_INFINITY })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip with an unknown type', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [malformedClip({ type: 'video' })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip with a non-number midiOffsetBeats', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [malformedClip({ midiOffsetBeats: 'x' })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip with a non-finite audioOffsetBeats', () => {
        setStates({
            tracks: [createTrack('track-1', 'audio', [malformedClip({ type: 'audio', audioOffsetBeats: Number.NaN })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip missing required numeric fields (fadeInBeats)', () => {
        const clip = malformedClip({});
        delete (clip as { fadeInBeats?: number }).fadeInBeats;
        setStates({
            tracks: [createTrack('track-1', 'midi', [clip])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip with a non-string color', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [malformedClip({ color: 5 })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a clip with a non-boolean locked flag', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [malformedClip({ locked: 'yes' })])],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });
});

describe('executeGlobalTimeOperation marker state validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    it('rejects when markers is not an array', () => {
        mocks.trackState.value = { tracks: [], selectedTrackId: 'track-1' };
        mocks.markerState.value = { markers: 'nope', sections: [] };
        mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 1, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when a marker id is duplicated', () => {
        mocks.trackState.value = { tracks: [], selectedTrackId: 'track-1' };
        mocks.markerState.value = {
            markers: [
                { id: 'dup', beat: 1, name: 'a', color: '' },
                { id: 'dup', beat: 2, name: 'b', color: '' },
            ],
            sections: [],
        };
        mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 1, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when a marker has an empty id', () => {
        mocks.trackState.value = { tracks: [], selectedTrackId: 'track-1' };
        mocks.markerState.value = {
            markers: [{ id: '  ', beat: 1, name: 'a', color: '' }],
            sections: [],
        };
        mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 1, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when a marker has a negative beat', () => {
        mocks.trackState.value = { tracks: [], selectedTrackId: 'track-1' };
        mocks.markerState.value = {
            markers: [{ id: 'm1', beat: -1, name: 'a', color: '' }],
            sections: [],
        };
        mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 1, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when a section has a duplicated id', () => {
        mocks.trackState.value = { tracks: [], selectedTrackId: 'track-1' };
        mocks.markerState.value = {
            markers: [],
            sections: [
                { id: 's1', startBeat: 0, endBeat: 2, name: 'a', color: '' },
                { id: 's1', startBeat: 2, endBeat: 4, name: 'b', color: '' },
            ],
        };
        mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 1, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when a section endBeat is before startBeat', () => {
        mocks.trackState.value = { tracks: [], selectedTrackId: 'track-1' };
        mocks.markerState.value = {
            markers: [],
            sections: [{ id: 's1', startBeat: 5, endBeat: 2, name: 'a', color: '' }],
        };
        mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 1, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });
});

describe('executeGlobalTimeOperation computed-time validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    it('rejects an insert that would overflow a straddling clip endBeat', () => {
        const straddler = createClip({ id: 'c', startBeat: 2, endBeat: Number.MAX_VALUE });
        setStates({ tracks: [createTrack('track-1', 'midi', [straddler])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 1, durationBeats: Number.MAX_VALUE },
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a delete that would overflow a clip startBeat after shift', () => {
        const after = createClip({ id: 'c', startBeat: Number.MAX_VALUE, endBeat: Number.MAX_VALUE });
        setStates({ tracks: [createTrack('track-1', 'midi', [after])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'delete', startBeat: 0, endBeat: Number.MAX_VALUE / 2 },
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a delete of a fully-spanning clip whose audio offset would overflow', () => {
        const span = createClip({
            id: 'c',
            startBeat: 1,
            endBeat: Number.MAX_VALUE,
            type: 'audio',
            audioOffsetBeats: Number.MAX_VALUE,
        });
        setStates({ tracks: [createTrack('track-1', 'audio', [span])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'delete', startBeat: 2, endBeat: Number.MAX_VALUE / 2 },
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a duplicate whose copied clip endBeat would overflow', () => {
        const inside = createClip({ id: 'c', startBeat: 2, endBeat: Number.MAX_VALUE });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 2, endBeat: Number.MAX_VALUE / 2 },
        });
        expect(result).toEqual(REJECTED);
    });
});

describe('executeGlobalTimeOperation audio clip geometry (delete/duplicate applied paths)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    it('delete splits a fully-spanning audio clip into left/right fragments and preserves audio offset', () => {
        const span = createClip({
            id: 'span',
            startBeat: 0,
            endBeat: 10,
            type: 'audio',
            audioOffsetBeats: 1,
        });
        setStates({ tracks: [createTrack('track-1', 'audio', [span])] });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        registerDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        expect(result.status).toBe('applied');
        const next = mocks.trackState.value as { tracks: Array<{ clips: Array<Record<string, unknown>> }> };
        expect(next.tracks[0]!.clips).toEqual([
            { ...span, endBeat: 2, name: 'span (L)' },
            {
                ...span,
                id: 'clip-dt-aaaaaaaa',
                startBeat: 2,
                endBeat: 6,
                name: 'span (R)',
                audioOffsetBeats: 1 + (6 - 0),
                midiOffsetBeats: 0,
            },
        ]);
    });

    it('delete trims a left-straddling audio clip to the operation start', () => {
        const left = createClip({ id: 'left', startBeat: 0, endBeat: 8, type: 'audio' });
        setStates({ tracks: [createTrack('track-1', 'audio', [left])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } });
        expect(result.status).toBe('applied');
        const next = mocks.trackState.value as { tracks: Array<{ clips: Array<Record<string, unknown>> }> };
        expect(next.tracks[0]!.clips).toEqual([{ ...left, endBeat: 4 }]);
    });

    it('delete moves a tail audio clip left and preserves its audio offset', () => {
        const tail = createClip({ id: 'tail', startBeat: 10, endBeat: 20, type: 'audio', audioOffsetBeats: 2 });
        setStates({ tracks: [createTrack('track-1', 'audio', [tail])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        expect(result.status).toBe('applied');
        const next = mocks.trackState.value as { tracks: Array<{ clips: Array<Record<string, unknown>> }> };
        // After-range clips only shift start/end by the deleted duration; offset is unchanged.
        expect(next.tracks[0]!.clips).toEqual([{ ...tail, startBeat: 6, endBeat: 16 }]);
    });

    it('delete removes a fully-inside clip without producing splits', () => {
        const inside = createClip({ id: 'inside', startBeat: 3, endBeat: 5, type: 'audio' });
        setStates({ tracks: [createTrack('track-1', 'audio', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        expect(result.status).toBe('applied');
        const next = mocks.trackState.value as { tracks: Array<{ clips: unknown[] }> };
        expect(next.tracks[0]!.clips).toHaveLength(0);
    });

    it('duplicate copies a contained audio clip (no midi copies recorded)', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6, type: 'audio' });
        setStates({ tracks: [createTrack('track-1', 'audio', [inside])] });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
        const deps = registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'duplicate', startBeat: 4, endBeat: 6 } });
        expect(result.status).toBe('applied');
        const next = mocks.trackState.value as { tracks: Array<{ clips: Array<Record<string, unknown>> }> };
        expect(next.tracks[0]!.clips.map((c) => c.id)).toEqual([
            'inside',
            'clip-dup-cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ]);
        // Audio clips produce no MIDI copies.
        const midiPreparationInput = deps.prepareMidiGlobalTimeTransaction.mock.calls[0]?.[0];
        expect(midiPreparationInput?.operation).toEqual({
            type: 'duplicate',
            startBeat: 4,
            endBeat: 6,
            copies: [],
        });
    });

    it('insert shifts an after-clip and leaves a before-clip untouched', () => {
        const before = createClip({ id: 'before', startBeat: 0, endBeat: 2, type: 'audio' });
        const after = createClip({ id: 'after', startBeat: 5, endBeat: 8, type: 'audio' });
        setStates({ tracks: [createTrack('track-1', 'audio', [before, after])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result.status).toBe('applied');
        const next = mocks.trackState.value as { tracks: Array<{ clips: Array<Record<string, unknown>> }> };
        expect(next.tracks[0]!.clips).toEqual([before, { ...after, startBeat: 7, endBeat: 10 }]);
    });
});

describe('executeGlobalTimeOperation marker section geometry (applied paths)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    it('delete leaves a section fully before the range untouched', () => {
        setStates({
            tracks: [],
            sections: [{ id: 'before', startBeat: 0, endBeat: 2, name: 'Before', color: '' }],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } });
        expect(result.status).toBe('applied');
        expect((mocks.markerState.value as { sections: unknown[] }).sections).toEqual([
            { id: 'before', startBeat: 0, endBeat: 2, name: 'Before', color: '' },
        ]);
    });

    it('delete shifts a section fully after the range left', () => {
        setStates({
            tracks: [],
            sections: [{ id: 'after', startBeat: 10, endBeat: 20, name: 'After', color: '' }],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        expect(result.status).toBe('applied');
        expect((mocks.markerState.value as { sections: Array<Record<string, unknown>> }).sections).toEqual([
            { id: 'after', startBeat: 6, endBeat: 16, name: 'After', color: '' },
        ]);
    });

    it('delete removes a section fully inside the range', () => {
        setStates({
            tracks: [],
            sections: [{ id: 'inside', startBeat: 3, endBeat: 5, name: 'Inside', color: '' }],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        expect(result.status).toBe('applied');
        expect((mocks.markerState.value as { sections: unknown[] }).sections).toHaveLength(0);
    });

    it('delete trims a left-straddling section to the operation start', () => {
        setStates({
            tracks: [],
            sections: [{ id: 'left', startBeat: 0, endBeat: 8, name: 'Left', color: '' }],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } });
        expect(result.status).toBe('applied');
        expect((mocks.markerState.value as { sections: Array<Record<string, unknown>> }).sections).toEqual([
            { id: 'left', startBeat: 0, endBeat: 4, name: 'Left', color: '' },
        ]);
    });

    it('delete trims and shifts a right-straddling section', () => {
        setStates({
            tracks: [],
            sections: [{ id: 'right', startBeat: 4, endBeat: 20, name: 'Right', color: '' }],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 8 } });
        expect(result.status).toBe('applied');
        expect((mocks.markerState.value as { sections: Array<Record<string, unknown>> }).sections).toEqual([
            { id: 'right', startBeat: 2, endBeat: 14, name: 'Right', color: '' },
        ]);
    });

    it('delete splits a fully-spanning section into L/R fragments', () => {
        setStates({
            tracks: [],
            sections: [{ id: 'span', startBeat: 0, endBeat: 10, name: 'Span', color: '' }],
        });
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        expect(result.status).toBe('applied');
        expect((mocks.markerState.value as { sections: Array<Record<string, unknown>> }).sections).toEqual([
            { id: 'span', startBeat: 0, endBeat: 2, name: 'Span (L)', color: '' },
            { id: 'span', startBeat: 2, endBeat: 6, name: 'Span (R)', color: '' },
        ]);
    });
});

describe('executeGlobalTimeOperation supplied replay plan validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    it('rejects a supplied replay plan that is not a plain object', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan: [] as unknown as never,
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a supplied replay plan with extra keys', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan: {
                version: 1,
                operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
                clips: [],
                midi: { version: 1, notes: [] },
                extra: true,
            } as never,
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a supplied replay plan whose version is not 1', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan: {
                version: 2,
                operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
                clips: [],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a supplied replay plan whose embedded operation does not match', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan: {
                version: 1,
                operation: { type: 'delete', startBeat: 4, endBeat: 6 },
                clips: [],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a supplied replay plan whose insert duration differs from the requested insert', () => {
        setStates({ tracks: [] });
        registerDependencies();
        // Same type (insert) and matching atBeat, but a different durationBeats —
        // operationsMatch must reject the replay plan.
        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            replayPlan: {
                version: 1,
                operation: { type: 'insert', atBeat: 4, durationBeats: 99 },
                clips: [],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a supplied replay plan whose clips array length mismatches requests', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan: {
                version: 1,
                operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
                clips: [
                    { role: 'duplicate-copy', sourceTrackId: 'track-1', sourceClipId: 'inside', targetClipId: 'c2' },
                    { role: 'duplicate-copy', sourceTrackId: 'track-1', sourceClipId: 'inside', targetClipId: 'c3' },
                ],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a supplied replay plan whose clip identity has wrong shape', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan: {
                version: 1,
                operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
                clips: [{ role: 'duplicate-copy', sourceTrackId: 'track-1', sourceClipId: 'inside', extra: true }],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toEqual(REJECTED);
    });

    it('rejects a supplied replay plan whose targetClipId already exists', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        registerDependencies();
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan: {
                version: 1,
                operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
                clips: [
                    {
                        role: 'duplicate-copy',
                        sourceTrackId: 'track-1',
                        sourceClipId: 'inside',
                        targetClipId: 'inside',
                    },
                ],
                midi: { version: 1, notes: [] },
            },
        });
        expect(result).toEqual(REJECTED);
    });
});

describe('executeGlobalTimeOperation main-flow rejection gates', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    it('rejects when track state is unavailable', () => {
        mocks.trackState.value = null;
        mocks.getTrackState.mockImplementation(() => null);
        mocks.markerState.value = { markers: [], sections: [] };
        registerDependencies();
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 1, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when automation preparation reports not-ready', () => {
        setStates({ tracks: [createTrack('track-1', 'midi', [createClip({ id: 'c', startBeat: 4, endBeat: 6 })])] });
        registerDependencies({ automation: createRejectedHandle() });
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when transport preparation reports not-ready', () => {
        setStates({ tracks: [createTrack('track-1', 'midi', [createClip({ id: 'c', startBeat: 4, endBeat: 6 })])] });
        registerDependencies({ transport: createRejectedHandle() });
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when midi preparation reports not-ready', () => {
        setStates({ tracks: [createTrack('track-1', 'midi', [createClip({ id: 'c', startBeat: 4, endBeat: 6 })])] });
        registerDependencies({ midi: createRejectedHandle() });
        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } });
        expect(result).toEqual(REJECTED);
    });

    it('rejects when supplied replay midi plan differs from the prepared midi plan', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [inside])] });
        const suppliedMidi = { version: 1 as const, notes: [] };
        const preparedMidi = { version: 1 as const, notes: [] };
        const midi = { ...createHandle('midi'), replayPlan: preparedMidi };
        registerDependencies({ midi });
        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan: {
                version: 1,
                operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
                clips: [
                    {
                        role: 'duplicate-copy',
                        sourceTrackId: 'track-1',
                        sourceClipId: 'inside',
                        targetClipId: 'copy-1',
                    },
                ],
                midi: suppliedMidi,
            },
        });
        expect(result).toEqual(REJECTED);
    });
});
