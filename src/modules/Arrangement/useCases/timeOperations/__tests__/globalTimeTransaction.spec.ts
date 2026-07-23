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
        events: [] as string[],
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

vi.mock('../../../stores/markerStore', () => ({
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
}));

import { executeGlobalTimeOperation, UnrecoveredGlobalTimeStateError } from '../executeGlobalTimeOperation';
import { setTimeOperationDependencies } from '../timeOperationDependencies';

function createHandle(name: string, hasChanges = true) {
    return {
        status: 'ready' as const,
        hasChanges,
        replayPlan: { version: 1 as const, notes: [] },
        apply: vi.fn(() => {
            mocks.events.push(`apply:${name}`);
            expect(mocks.batchDepth).toBe(1);
            return true;
        }),
        revert: vi.fn(() => {
            mocks.events.push(`revert:${name}`);
            expect(mocks.batchDepth).toBe(1);
            return true;
        }),
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
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder' | 'vca',
    clips: ReturnType<typeof createClip>[]
) {
    return {
        id,
        kind,
        clips,
    };
}

function setStates(input?: {
    tracks?: ReturnType<typeof createTrack>[];
    markers?: Array<{ id: string; beat: number; name: string; color: string }>;
    sections?: Array<{ id: string; startBeat: number; endBeat: number; name: string; color: string }>;
}): void {
    mocks.trackState.value = {
        tracks: input?.tracks ?? [],
        selectedTrackId: 'track-1',
        ghostClips: [{ id: 'ghost-1' }],
        futureState: { preserved: true },
    };
    mocks.markerState.value = {
        markers: input?.markers ?? [],
        sections: input?.sections ?? [],
    };
    mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
}

function registerDependencies(input?: {
    automation?: ReturnType<typeof createHandle>;
    transport?: ReturnType<typeof createHandle>;
    midi?: ReturnType<typeof createHandle>;
}) {
    const automation = input?.automation ?? createHandle('automation');
    const transport = input?.transport ?? createHandle('transport');
    const midi = input?.midi ?? createHandle('midi');
    const prepareAutomationTimeOperation = vi.fn(() => automation);
    const prepareTimelineMapTimeOperation = vi.fn(() => transport);
    const prepareMidiGlobalTimeTransaction = vi.fn(() => midi);
    setTimeOperationDependencies({
        prepareAutomationTimeOperation,
        prepareTimelineMapTimeOperation,
        prepareMidiGlobalTimeTransaction,
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

function createMalformedInputs(): Array<Parameters<typeof executeGlobalTimeOperation>[0]> {
    const extraKeyInput = {
        operation: { type: 'insert' as const, atBeat: 4, durationBeats: 2 },
        extra: true,
    };
    return [
        { operation: { type: 'insert', atBeat: -1, durationBeats: 2 } },
        { operation: { type: 'delete', startBeat: 4, endBeat: 4 } },
        { operation: { type: 'duplicate', startBeat: 6, endBeat: 4 } },
        extraKeyInput,
    ];
}

describe('executeGlobalTimeOperation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.events.length = 0;
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        setTimeOperationDependencies(null);
    });

    it('applies insert geometry, complete owner snapshots, and dormant identity preservation in one batch', () => {
        const before = createClip({ id: 'before', startBeat: 0, endBeat: 2 });
        const straddler = createClip({ id: 'straddler', startBeat: 2, endBeat: 6 });
        const after = createClip({ id: 'after', startBeat: 5, endBeat: 7 });
        const dormantClip = createClip({
            id: 'dormant',
            trackId: 'vca-1',
            startBeat: 5,
            endBeat: 8,
        });
        const eligibleTrack = createTrack('track-1', 'midi', [before, straddler, after]);
        const dormantTrack = createTrack('vca-1', 'vca', [dormantClip]);
        setStates({
            tracks: [eligibleTrack, dormantTrack],
            markers: [
                { id: 'before-marker', beat: 3, name: 'Before', color: '' },
                { id: 'after-marker', beat: 5, name: 'After', color: '' },
            ],
        });
        const capturedState = mocks.trackState.value;
        const dependencies = registerDependencies();

        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(result.status).toBe('applied');
        expect(mocks.writeDepths.every((depth) => depth === 1)).toBe(true);
        const nextState = mocks.trackState.value as {
            tracks: Array<{ clips: ReturnType<typeof createClip>[] }>;
            selectedTrackId: string;
            ghostClips: unknown[];
            futureState: unknown;
        };
        expect(nextState).not.toBe(capturedState);
        expect(nextState.tracks[0]!.clips).toEqual([
            before,
            { ...straddler, endBeat: 8 },
            { ...after, startBeat: 7, endBeat: 9 },
        ]);
        expect(nextState.tracks[1]).toBe(dormantTrack);
        expect(nextState.tracks[1]!.clips[0]).toBe(dormantClip);
        expect(nextState.selectedTrackId).toBe('track-1');
        expect(nextState.ghostClips).toEqual([{ id: 'ghost-1' }]);
        expect(nextState.futureState).toEqual({ preserved: true });
        expect(mocks.markerState.value).toMatchObject({
            markers: [
                { id: 'before-marker', beat: 3 },
                { id: 'after-marker', beat: 7 },
            ],
        });
        expect(dependencies.prepareAutomationTimeOperation).toHaveBeenCalledExactlyOnceWith({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [
                {
                    trackId: 'track-1',
                    eligible: true,
                    clipIds: ['before', 'straddler', 'after'],
                },
                {
                    trackId: 'vca-1',
                    eligible: false,
                    clipIds: ['dormant'],
                },
            ],
        });
        expect(dependencies.prepareMidiGlobalTimeTransaction).toHaveBeenCalledWith({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [
                {
                    trackId: 'track-1',
                    eligible: true,
                    clips: [
                        { clipId: 'before', startBeat: 0, endBeat: 2 },
                        { clipId: 'straddler', startBeat: 2, endBeat: 6 },
                        { clipId: 'after', startBeat: 5, endBeat: 7 },
                    ],
                },
                {
                    trackId: 'vca-1',
                    eligible: false,
                    clips: [{ clipId: 'dormant', startBeat: 5, endBeat: 8 }],
                },
            ],
        });
    });

    it('preserves delete clip, MIDI-plan, marker, and section geometry', () => {
        const inside = createClip({ id: 'inside', startBeat: 2, endBeat: 4 });
        const span = createClip({ id: 'span', startBeat: 0, endBeat: 10, midiOffsetBeats: 1 });
        const left = createClip({ id: 'left', startBeat: 1, endBeat: 4 });
        const right = createClip({ id: 'right', startBeat: 4, endBeat: 9 });
        const after = createClip({ id: 'after', startBeat: 8, endBeat: 12 });
        setStates({
            tracks: [createTrack('track-1', 'midi', [inside, span, left, right, after])],
            markers: [
                { id: 'inside-marker', beat: 3, name: 'Inside', color: '' },
                { id: 'after-marker', beat: 8, name: 'After', color: '' },
            ],
            sections: [{ id: 'span-section', startBeat: 0, endBeat: 10, name: 'Span', color: '' }],
        });
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
            .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
            .mockReturnValueOnce('33333333-3333-4333-8333-333333333333');
        const dependencies = registerDependencies();

        const result = executeGlobalTimeOperation({
            operation: { type: 'delete', startBeat: 2, endBeat: 6 },
        });

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            throw new Error('Expected applied delete');
        }
        expect(result.replayPlan.clips).toEqual([
            {
                role: 'delete-right',
                sourceTrackId: 'track-1',
                sourceClipId: 'span',
                targetClipId: 'clip-dt-11111111',
            },
            {
                role: 'delete-discard',
                sourceTrackId: 'track-1',
                sourceClipId: 'left',
                targetClipId: 'clip-dt-discard-22222222',
            },
            {
                role: 'delete-right',
                sourceTrackId: 'track-1',
                sourceClipId: 'right',
                targetClipId: 'clip-dt-33333333',
            },
        ]);
        expect(dependencies.prepareMidiGlobalTimeTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: {
                    type: 'delete',
                    startBeat: 2,
                    endBeat: 6,
                    splits: [
                        {
                            sourceClipId: 'span',
                            newClipId: 'clip-dt-11111111',
                            splitBeat: 7,
                            discardBeforeBeat: 3,
                        },
                        {
                            sourceClipId: 'left',
                            newClipId: 'clip-dt-discard-22222222',
                            splitBeat: 1,
                            discardBeforeBeat: 1,
                        },
                        {
                            sourceClipId: 'right',
                            newClipId: 'clip-dt-33333333',
                            splitBeat: 2,
                            discardBeforeBeat: 2,
                        },
                    ],
                    removeClipIds: ['inside', 'clip-dt-discard-22222222', 'right'],
                },
            })
        );
        expect(mocks.markerState.value).toEqual({
            markers: [{ id: 'after-marker', beat: 4, name: 'After', color: '' }],
            sections: [
                { id: 'span-section', startBeat: 0, endBeat: 2, name: 'Span (L)', color: '' },
                { id: 'span-section', startBeat: 2, endBeat: 6, name: 'Span (R)', color: '' },
            ],
        });
    });

    it('duplicates only eligible fully-contained clips and asks MIDI for note-only copies', () => {
        const inside = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        const partial = createClip({ id: 'partial', startBeat: 3, endBeat: 5 });
        const after = createClip({ id: 'after', startBeat: 8, endBeat: 10 });
        const dormant = createClip({
            id: 'dormant',
            trackId: 'vca-1',
            startBeat: 4,
            endBeat: 6,
        });
        const dormantTrack = createTrack('vca-1', 'vca', [dormant]);
        setStates({
            tracks: [createTrack('track-1', 'midi', [inside, partial, after]), dormantTrack],
            markers: [{ id: 'marker', beat: 8, name: 'Marker', color: '' }],
        });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('44444444-4444-4444-8444-444444444444');
        const dependencies = registerDependencies();

        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
        });

        expect(result.status).toBe('applied');
        const nextState = mocks.trackState.value as { tracks: Array<{ clips: Array<{ id: string }> }> };
        expect(nextState.tracks[0]!.clips.map((clip) => clip.id)).toEqual([
            'inside',
            'partial',
            'after',
            'clip-dup-44444444-4444-4444-8444-444444444444',
        ]);
        expect(nextState.tracks[1]).toBe(dormantTrack);
        expect(dependencies.prepareAutomationTimeOperation).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: { type: 'insert', atBeat: 6, durationBeats: 2 },
            })
        );
        expect(dependencies.prepareTimelineMapTimeOperation).toHaveBeenCalledWith({
            operation: { type: 'insert', atBeat: 6, durationBeats: 2 },
        });
        expect(dependencies.prepareMidiGlobalTimeTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: {
                    type: 'duplicate',
                    startBeat: 4,
                    endBeat: 6,
                    copies: [
                        {
                            sourceClipId: 'inside',
                            newClipId: 'clip-dup-44444444-4444-4444-8444-444444444444',
                        },
                    ],
                },
            })
        );
    });

    it('rejects malformed complete ownership before owner preparation or identity allocation', () => {
        setStates({
            tracks: [
                createTrack('track-1', 'midi', [
                    createClip({
                        id: 'wrong-owner',
                        trackId: 'another-track',
                        startBeat: 4,
                        endBeat: 6,
                    }),
                ]),
            ],
        });
        const dependencies = registerDependencies();
        const randomUUID = vi.spyOn(crypto, 'randomUUID');

        const result = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
        });

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null });
        expect(dependencies.prepareAutomationTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMapTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareMidiGlobalTimeTransaction).not.toHaveBeenCalled();
        expect(randomUUID).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.setMarkerState).not.toHaveBeenCalled();
    });

    it('rejects computed insert clip overflow before writes or owner application', () => {
        const overflowingClip = createClip({
            id: 'overflowing',
            startBeat: Number.MAX_VALUE / 2,
            endBeat: Number.MAX_VALUE,
        });
        setStates({ tracks: [createTrack('track-1', 'midi', [overflowingClip])] });
        const dependencies = registerDependencies();
        const randomUUID = vi.spyOn(crypto, 'randomUUID');

        const result = executeGlobalTimeOperation({
            operation: {
                type: 'insert',
                atBeat: 1,
                durationBeats: Number.MAX_VALUE,
            },
        });

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null });
        expect(randomUUID).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.setMarkerState).not.toHaveBeenCalled();
        expect(dependencies.prepareAutomationTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMapTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareMidiGlobalTimeTransaction).not.toHaveBeenCalled();
        expect(dependencies.automation.apply).not.toHaveBeenCalled();
        expect(dependencies.transport.apply).not.toHaveBeenCalled();
        expect(dependencies.midi.apply).not.toHaveBeenCalled();
    });

    it('rejects computed insert marker overflow before writes or owner application', () => {
        setStates({
            markers: [{ id: 'overflowing-marker', beat: Number.MAX_VALUE, name: 'Overflow', color: '' }],
        });
        const dependencies = registerDependencies();
        const randomUUID = vi.spyOn(crypto, 'randomUUID');

        const result = executeGlobalTimeOperation({
            operation: {
                type: 'insert',
                atBeat: 1,
                durationBeats: Number.MAX_VALUE,
            },
        });

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null });
        expect(randomUUID).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.setMarkerState).not.toHaveBeenCalled();
        expect(dependencies.prepareAutomationTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMapTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareMidiGlobalTimeTransaction).not.toHaveBeenCalled();
        expect(dependencies.automation.apply).not.toHaveBeenCalled();
        expect(dependencies.transport.apply).not.toHaveBeenCalled();
        expect(dependencies.midi.apply).not.toHaveBeenCalled();
    });

    it('rejects computed delete audio-offset overflow before identity allocation or writes', () => {
        const overflowingClip = createClip({
            id: 'overflowing-offset',
            startBeat: 1,
            endBeat: Number.MAX_VALUE,
            type: 'audio',
            audioOffsetBeats: Number.MAX_VALUE,
        });
        setStates({ tracks: [createTrack('track-1', 'audio', [overflowingClip])] });
        const dependencies = registerDependencies();
        const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue('66666666-6666-4666-8666-666666666666');

        const result = executeGlobalTimeOperation({
            operation: {
                type: 'delete',
                startBeat: 0,
                endBeat: Number.MAX_VALUE / 2,
            },
        });

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null });
        expect(randomUUID).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.setMarkerState).not.toHaveBeenCalled();
        expect(dependencies.prepareAutomationTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMapTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareMidiGlobalTimeTransaction).not.toHaveBeenCalled();
        expect(dependencies.automation.apply).not.toHaveBeenCalled();
        expect(dependencies.transport.apply).not.toHaveBeenCalled();
        expect(dependencies.midi.apply).not.toHaveBeenCalled();
    });

    it('rejects a present non-finite audio offset during ownership preflight', () => {
        const malformedClip = createClip({
            id: 'malformed-offset',
            startBeat: 1,
            endBeat: 4,
            type: 'audio',
            audioOffsetBeats: Number.POSITIVE_INFINITY,
        });
        setStates({ tracks: [createTrack('track-1', 'audio', [malformedClip])] });
        const dependencies = registerDependencies();
        const randomUUID = vi.spyOn(crypto, 'randomUUID');

        const result = executeGlobalTimeOperation({
            operation: {
                type: 'delete',
                startBeat: 1,
                endBeat: 2,
            },
        });

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null });
        expect(randomUUID).not.toHaveBeenCalled();
        expect(dependencies.prepareAutomationTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMapTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareMidiGlobalTimeTransaction).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.setMarkerState).not.toHaveBeenCalled();
    });

    it.each(createMalformedInputs())('rejects malformed or non-exact input %# without writes', (runtimeInput) => {
        const dependencies = registerDependencies();

        const result = executeGlobalTimeOperation(runtimeInput);

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null });
        expect(dependencies.prepareAutomationTimeOperation).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('reuses an exact supplied replay plan byte-for-byte without allocating identities', () => {
        const source = createClip({ id: 'inside', startBeat: 4, endBeat: 6 });
        const originalTrack = createTrack('track-1', 'midi', [source]);
        setStates({ tracks: [originalTrack] });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('55555555-5555-4555-8555-555555555555');
        const firstDependencies = registerDependencies();

        const first = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
        });
        expect(first.status).toBe('applied');
        if (first.status !== 'applied') {
            throw new Error('Expected first replay-producing operation to apply');
        }
        const replayPlan = first.replayPlan;

        setStates({ tracks: [originalTrack] });
        vi.restoreAllMocks();
        const automation = createHandle('automation');
        const transport = createHandle('transport');
        const midi = createHandle('midi');
        const prepareMidiGlobalTimeTransaction = vi.fn((input: { replayPlan?: typeof replayPlan.midi }) => ({
            ...midi,
            replayPlan: input.replayPlan ?? midi.replayPlan,
        }));
        setTimeOperationDependencies({
            prepareAutomationTimeOperation: vi.fn(() => automation),
            prepareTimelineMapTimeOperation: vi.fn(() => transport),
            prepareMidiGlobalTimeTransaction,
        });
        const randomUUID = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
            throw new Error('Replay must not allocate');
        });

        const second = executeGlobalTimeOperation({
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            replayPlan,
        });

        expect(second.status).toBe('applied');
        if (second.status !== 'applied') {
            throw new Error('Expected supplied replay to apply');
        }
        expect(second.replayPlan).toBe(replayPlan);
        expect(randomUUID).not.toHaveBeenCalled();
        expect(prepareMidiGlobalTimeTransaction).toHaveBeenCalledWith(
            expect.objectContaining({ replayPlan: replayPlan.midi })
        );
        expect(firstDependencies.prepareMidiGlobalTimeTransaction).toHaveBeenCalledOnce();
    });

    it('rejects reordered, extra, duplicate, or colliding clip replay identities', () => {
        const one = createClip({ id: 'one', startBeat: 4, endBeat: 5 });
        const two = createClip({ id: 'two', startBeat: 5, endBeat: 6 });
        setStates({ tracks: [createTrack('track-1', 'midi', [one, two])] });
        const dependencies = registerDependencies();
        const invalidReplay = {
            version: 1,
            operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            clips: [
                {
                    role: 'duplicate-copy',
                    sourceTrackId: 'track-1',
                    sourceClipId: 'two',
                    targetClipId: 'one',
                },
                {
                    role: 'duplicate-copy',
                    sourceTrackId: 'track-1',
                    sourceClipId: 'one',
                    targetClipId: 'one',
                },
            ],
            midi: { version: 1, notes: [] },
        } as const;
        const invalidInput = {
            operation: { type: 'duplicate' as const, startBeat: 4, endBeat: 6 },
            replayPlan: invalidReplay,
        };

        const result = executeGlobalTimeOperation(invalidInput);

        expect(result.status).toBe('rejected');
        expect(dependencies.prepareMidiGlobalTimeTransaction).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('returns no-change and never calls closed owner handles', () => {
        const unchanged = createClip({ id: 'before', startBeat: 0, endBeat: 2 });
        setStates({
            tracks: [createTrack('track-1', 'midi', [unchanged])],
            markers: [{ id: 'before-marker', beat: 2, name: 'Before', color: '' }],
        });
        const automation = createHandle('automation', false);
        const transport = createHandle('transport', false);
        const midi = createHandle('midi', false);
        registerDependencies({ automation, transport, midi });

        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(result.status).toBe('no-change');
        expect(automation.apply).not.toHaveBeenCalled();
        expect(automation.revert).not.toHaveBeenCalled();
        expect(transport.apply).not.toHaveBeenCalled();
        expect(midi.apply).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.setMarkerState).not.toHaveBeenCalled();
    });

    it('fails missing dependency registration before identity allocation or writes', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [createClip({ id: 'inside', startBeat: 4, endBeat: 6 })])],
        });
        const randomUUID = vi.spyOn(crypto, 'randomUUID');

        expect(() =>
            executeGlobalTimeOperation({
                operation: { type: 'duplicate', startBeat: 4, endBeat: 6 },
            })
        ).toThrow('Arrangement time operation dependencies are not registered');
        expect(randomUUID).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('rejects a stale local capture without applying an owner handle', () => {
        const original = {
            tracks: [createTrack('track-1', 'midi', [createClip({ id: 'clip-1', startBeat: 4, endBeat: 6 })])],
            selectedTrackId: 'track-1',
        };
        const stale = { ...original, selectedTrackId: null };
        mocks.trackState.value = original;
        mocks.getTrackState.mockReturnValueOnce(original).mockReturnValue(stale);
        mocks.markerState.value = {
            markers: [{ id: 'marker-1', beat: 5, name: 'Marker', color: '' }],
            sections: [],
        };
        const dependencies = registerDependencies();

        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(result.status).toBe('rejected');
        expect(dependencies.automation.apply).not.toHaveBeenCalled();
        expect(dependencies.transport.apply).not.toHaveBeenCalled();
        expect(dependencies.midi.apply).not.toHaveBeenCalled();
    });

    it('compensates successfully applied handles in strict reverse order', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [createClip({ id: 'clip-1', startBeat: 2, endBeat: 6 })])],
            markers: [{ id: 'marker-1', beat: 5, name: 'Marker', color: '' }],
        });
        const automation = createHandle('automation');
        const transport = createHandle('transport');
        const midi = createHandle('midi');
        midi.apply.mockImplementation(() => {
            mocks.events.push('apply:midi');
            return false;
        });
        registerDependencies({ automation, transport, midi });

        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(result.status).toBe('rejected');
        expect(mocks.events).toEqual([
            'apply:automation',
            'apply:transport',
            'apply:midi',
            'revert:transport',
            'revert:automation',
        ]);
    });

    it('recovers a local publication that throws after storing the prepared reference', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [createClip({ id: 'clip-1', startBeat: 2, endBeat: 6 })])],
        });
        const capturedTrackState = mocks.trackState.value;
        const publicationError = new Error('track publication failed after storage');
        mocks.setTrackState.mockImplementationOnce(() => {
            throw publicationError;
        });
        const dependencies = registerDependencies();

        expect(() =>
            executeGlobalTimeOperation({
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            })
        ).toThrow(publicationError);
        expect(mocks.trackState.value).toBe(capturedTrackState);
        expect(dependencies.automation.apply).not.toHaveBeenCalled();
        expect(dependencies.transport.apply).not.toHaveBeenCalled();
        expect(dependencies.midi.apply).not.toHaveBeenCalled();
    });

    it('rethrows an owner publication error after successful cross-owner recovery', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [createClip({ id: 'clip-1', startBeat: 2, endBeat: 6 })])],
            markers: [{ id: 'marker-1', beat: 5, name: 'Marker', color: '' }],
        });
        const capturedTrackState = mocks.trackState.value;
        const capturedMarkerState = mocks.markerState.value;
        const ownerError = new Error('owner publication failed');
        const automation = createHandle('automation');
        automation.apply.mockImplementation(() => {
            throw ownerError;
        });
        registerDependencies({ automation });

        expect(() =>
            executeGlobalTimeOperation({
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            })
        ).toThrow(ownerError);
        expect(mocks.trackState.value).toBe(capturedTrackState);
        expect(mocks.markerState.value).toBe(capturedMarkerState);
    });

    it('attempts every reverse compensation and reports all unrecovered failures', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [createClip({ id: 'clip-1', startBeat: 2, endBeat: 6 })])],
            markers: [{ id: 'marker-1', beat: 5, name: 'Marker', color: '' }],
        });
        const capturedTrackState = mocks.trackState.value;
        const capturedMarkerState = mocks.markerState.value;
        const automation = createHandle('automation');
        automation.revert.mockImplementation(() => {
            mocks.events.push('revert:automation');
            return false;
        });
        const transport = createHandle('transport');
        const transportCompensationFailure = new Error('transport compensation failed');
        transport.revert.mockImplementation(() => {
            mocks.events.push('revert:transport');
            throw transportCompensationFailure;
        });
        const midi = createHandle('midi');
        midi.apply.mockImplementation(() => false);
        registerDependencies({ automation, transport, midi });

        let thrown: unknown;
        try {
            executeGlobalTimeOperation({
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(UnrecoveredGlobalTimeStateError);
        if (!(thrown instanceof UnrecoveredGlobalTimeStateError)) {
            throw new Error('Expected explicit unrecovered global-time error');
        }
        expect(thrown.compensationFailures).toEqual([
            transportCompensationFailure,
            expect.objectContaining({ message: 'Automation compensation returned false' }),
        ]);
        expect(transport.revert).toHaveBeenCalledOnce();
        expect(automation.revert).toHaveBeenCalledOnce();
        expect(mocks.trackState.value).toBe(capturedTrackState);
        expect(mocks.markerState.value).toBe(capturedMarkerState);
    });
});
