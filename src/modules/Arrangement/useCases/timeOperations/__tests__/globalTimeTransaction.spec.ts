import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getAutomationStoreState,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
    restoreAutomationSnapshot,
} from '#/modules/Automation/useCases';

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
import { executeGlobalTimeOperation, UnrecoveredGlobalTimeStateError } from '../executeGlobalTimeOperation';
import { executeUndoableInsertTime } from '../executeUndoableInsertTime';
import { prepareTimeOperationStateRestore } from '../prepareTimeOperationStateRestore';
import { setTimeOperationDependencies } from '../timeOperationDependencies';
import { timeOperationStateCodec } from '../timeOperationStateCodec';

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
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder',
    clips: ReturnType<typeof createClip>[]
) {
    return TrackDummy.create({ id, kind, clips });
}

function createDormantTrack(id: string, clips: ReturnType<typeof createClip>[]) {
    const track = TrackDummy.create({ id, kind: 'folder', clips });
    Object.defineProperty(track, 'kind', {
        configurable: true,
        enumerable: true,
        value: 'vca',
        writable: true,
    });
    return track;
}

function setStates(input?: {
    tracks?: ReturnType<typeof createTrack>[];
    markers?: Array<{ id: string; beat: number; name: string; color: string }>;
    sections?: Array<{ id: string; startBeat: number; endBeat: number; name: string; color: string }>;
}): void {
    mocks.trackState.value = {
        tracks: input?.tracks ?? [],
        selectedTrackId: 'track-1',
        ghostClips: [createClip({ id: 'ghost-1', trackId: 'ghost-track', startBeat: 0, endBeat: 1 })],
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

function requireRecord(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected an object record');
    }
    return value as Record<string, unknown>;
}

describe('executeGlobalTimeOperation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.events.length = 0;
        mocks.writeDepths.length = 0;
        mocks.batchDepth = 0;
        setStates();
        restoreAutomationSnapshot({ lanes: [] });
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
        eligibleTrack.pan = -0;
        const dormantTrack = createDormantTrack('vca-1', [dormantClip]);
        setStates({
            tracks: [eligibleTrack, dormantTrack],
            markers: [
                { id: 'before-marker', beat: 3, name: 'Before', color: '' },
                { id: 'after-marker', beat: 5, name: 'After', color: '' },
            ],
        });
        const capturedState = mocks.trackState.value;
        const capturedMarkerState = mocks.markerState.value;
        const dependencies = registerDependencies();

        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            throw new Error('Expected applied global insert');
        }
        expect(mocks.writeDepths.every((depth) => depth === 1)).toBe(true);
        const nextState = mocks.trackState.value as {
            tracks: Array<{ clips: ReturnType<typeof createClip>[] }>;
            selectedTrackId: string;
            ghostClips: unknown[];
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
        expect(nextState.ghostClips).toEqual([
            createClip({ id: 'ghost-1', trackId: 'ghost-track', startBeat: 0, endBeat: 1 }),
        ]);
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
            removedClipIds: [],
            clipIdMigrations: [],
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
        expect(JSON.parse(JSON.stringify(result.inversePlan))).toEqual(result.inversePlan);
        const inversePlan = requireRecord(result.inversePlan);
        expect(inversePlan).toMatchObject({
            version: 1,
            scope: 'global',
            automation: {
                version: 1,
                expected: { owner: 'automation', state: 'next' },
                replacement: { owner: 'automation', state: 'previous' },
            },
            midi: {
                version: 1,
                expected: { owner: 'midi', state: 'next' },
                replacement: { owner: 'midi', state: 'previous' },
            },
            timelineMap: {
                version: 1,
                expected: { owner: 'transport', state: 'next' },
                replacement: { owner: 'transport', state: 'previous' },
            },
        });
        const local = requireRecord(inversePlan.local);
        const expected = requireRecord(local.expected);
        const replacement = requireRecord(local.replacement);
        const expectedTrackState = timeOperationStateCodec.decodeTrackState(expected.trackState);
        const replacementTrackState = timeOperationStateCodec.decodeTrackState(replacement.trackState);
        const expectedMarkers = timeOperationStateCodec.decodeMarkerState(expected.markerState);
        const replacementMarkers = timeOperationStateCodec.decodeMarkerState(replacement.markerState);
        expect(expectedTrackState).toEqual(nextState);
        expect(expectedTrackState).not.toBe(nextState);
        expect(replacementTrackState).toEqual(capturedState);
        expect(replacementTrackState).not.toBe(capturedState);
        expect(expectedMarkers).toEqual(mocks.markerState.value);
        expect(replacementMarkers).toEqual(capturedMarkerState);
        expect(Object.is(expectedTrackState?.tracks[0]?.pan, -0)).toBe(true);
        expect(Object.is(replacementTrackState?.tracks[0]?.pan, -0)).toBe(true);
    });

    it('rejects exact redo after a marker changes post-undo', () => {
        const clip = createClip({ id: 'clip-1', startBeat: 5, endBeat: 7 });
        setStates({
            tracks: [createTrack('track-1', 'midi', [clip])],
            markers: [{ id: 'marker-1', beat: 5, name: 'Marker', color: '' }],
        });
        const beforeTrackState = structuredClone(mocks.trackState.value);
        const beforeMarkerState = structuredClone(mocks.markerState.value);
        registerDependencies({
            automation: createHandle('automation', false),
            transport: createHandle('transport', false),
            midi: createHandle('midi', false),
        });
        const transaction = executeUndoableInsertTime(4, 2);
        transaction?.undo();
        const collaboratorMarkerState = {
            markers: [{ id: 'marker-1', beat: 6, name: 'Collaborator', color: '' }],
            sections: [],
        };
        mocks.markerState.value = collaboratorMarkerState;

        expect(() => transaction?.redo()).toThrow('Global time operation redo conflicts with current project state');
        expect(mocks.trackState.value).toEqual(beforeTrackState);
        expect(mocks.markerState.value).toBe(collaboratorMarkerState);

        mocks.markerState.value = beforeMarkerState;
        expect(() => transaction?.redo()).not.toThrow();
        expect(mocks.markerState.value).toMatchObject({ markers: [{ id: 'marker-1', beat: 7 }] });
    });

    it('round trips and restores exact negative zero from a real Automation owner plan', () => {
        setStates({
            tracks: [createTrack('track-1', 'audio', [])],
        });
        restoreAutomationSnapshot({
            lanes: [
                {
                    id: 'lane-negative-zero',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        {
                            beat: 4,
                            value: -0,
                            curve: 'linear',
                            tension: 0,
                        },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
        const transport = createHandle('transport', false);
        const midi = createHandle('midi', false);
        setTimeOperationDependencies({
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareTimelineMapTimeOperation: vi.fn(() => transport),
            prepareTimelineMapStateRestore: vi.fn(() => createHandle('transport-restore', false)),
            prepareMidiGlobalTimeTransaction: vi.fn(() => midi),
            prepareMidiTimeStateRestore: vi.fn(() => createHandle('midi-restore', false)),
        });

        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            throw new Error('Expected applied global insert');
        }
        const appliedPoint = getAutomationStoreState()?.lanes[0]?.points[0];
        expect(appliedPoint?.beat).toBe(6);
        expect(Object.is(appliedPoint?.value, -0)).toBe(true);

        const roundTrippedPlan: unknown = JSON.parse(JSON.stringify(result.inversePlan));
        expect(roundTrippedPlan).toEqual(result.inversePlan);
        const restore = prepareTimeOperationStateRestore(roundTrippedPlan);
        expect(restore.status).toBe('ready');
        expect(restore.hasChanges).toBe(true);
        expect(restore.apply()).toBe(true);

        const restoredPoint = getAutomationStoreState()?.lanes[0]?.points[0];
        expect(restoredPoint?.beat).toBe(4);
        expect(Object.is(restoredPoint?.value, -0)).toBe(true);
        expect(restore.revert()).toBe(true);
        const redonePoint = getAutomationStoreState()?.lanes[0]?.points[0];
        expect(redonePoint?.beat).toBe(6);
        expect(Object.is(redonePoint?.value, -0)).toBe(true);
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
                {
                    id: 'span-section:time-delete-right:2:6',
                    startBeat: 2,
                    endBeat: 6,
                    name: 'Span (R)',
                    color: '',
                },
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
        const dormantTrack = createDormantTrack('vca-1', [dormant]);
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

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null });
        expect(dependencies.prepareAutomationTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMapTimeOperation).not.toHaveBeenCalled();
        expect(dependencies.prepareMidiGlobalTimeTransaction).not.toHaveBeenCalled();
        expect(randomUUID).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.setMarkerState).not.toHaveBeenCalled();
    });

    it('rejects a non-encodable local snapshot before publication', () => {
        const track = createTrack('track-1', 'audio', [
            createClip({ id: 'clip-1', startBeat: 0, endBeat: 4, type: 'audio' }),
        ]);
        Object.defineProperty(track, Symbol('unsupported'), {
            enumerable: true,
            value: true,
        });
        setStates({ tracks: [track] });
        const dependencies = registerDependencies();

        const result = executeGlobalTimeOperation({
            operation: { type: 'insert', atBeat: 2, durationBeats: 1 },
        });

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null });
        expect(mocks.writeDepths).toEqual([]);
        expect(dependencies.automation.apply).not.toHaveBeenCalled();
        expect(dependencies.transport.apply).not.toHaveBeenCalled();
        expect(dependencies.midi.apply).not.toHaveBeenCalled();
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

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null });
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

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null });
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

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null });
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

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null });
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

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null });
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
            prepareAutomationTimeStateRestore: vi.fn(() => createHandle('automation-restore', false)),
            prepareTimelineMapTimeOperation: vi.fn(() => transport),
            prepareTimelineMapStateRestore: vi.fn(() => createHandle('transport-restore', false)),
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore: vi.fn(() => createHandle('midi-restore', false)),
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

    it('rejects changed owners without an inverse plan and unchanged owners with one', () => {
        const clip = createClip({ id: 'clip-1', startBeat: 4, endBeat: 6 });
        const operation = { type: 'insert' as const, atBeat: 4, durationBeats: 2 };

        setStates({ tracks: [createTrack('track-1', 'midi', [clip])] });
        const missingInverse = createHandle('automation');
        missingInverse.inversePlan = null;
        const transportNoChange = createHandle('transport', false);
        const midiNoChange = createHandle('midi', false);
        registerDependencies({
            automation: missingInverse,
            transport: transportNoChange,
            midi: midiNoChange,
        });

        expect(executeGlobalTimeOperation({ operation })).toEqual({
            status: 'rejected',
            hasChanges: false,
            replayPlan: null,
            inversePlan: null,
        });
        expect(mocks.writeDepths).toEqual([]);

        vi.clearAllMocks();
        setStates({ tracks: [createTrack('track-1', 'midi', [clip])] });
        const unexpectedInverse = createHandle('automation', false);
        unexpectedInverse.inversePlan = {
            version: 1,
            expected: { state: 'next' },
            replacement: { state: 'previous' },
        };
        registerDependencies({
            automation: unexpectedInverse,
            transport: createHandle('transport', false),
            midi: createHandle('midi', false),
        });

        expect(executeGlobalTimeOperation({ operation })).toEqual({
            status: 'rejected',
            hasChanges: false,
            replayPlan: null,
            inversePlan: null,
        });
        expect(mocks.writeDepths).toEqual([]);
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

    it('reports unrecovered state when a throwing local write leaves an unexpected reference', () => {
        setStates({
            tracks: [createTrack('track-1', 'midi', [createClip({ id: 'clip-1', startBeat: 2, endBeat: 6 })])],
        });
        const unexpectedTrackState = {
            tracks: [],
            selectedTrackId: 'unexpected',
        };
        const publicationError = new Error('track publication left an unexpected state');
        mocks.setTrackState.mockImplementationOnce(() => {
            mocks.trackState.value = unexpectedTrackState;
            throw publicationError;
        });
        const dependencies = registerDependencies();

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
        expect(thrown.originalFailure).toBe(publicationError);
        expect(thrown.compensationFailures).toEqual([
            expect.objectContaining({
                message: 'Arrangement cannot safely compensate an unexpected published reference',
            }),
        ]);
        expect(mocks.trackState.value).toBe(unexpectedTrackState);
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
