import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getAutomationLanes,
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
        batchDepth: 0,
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
        mocks.trackState.value = state;
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
                mocks.markerState.value = state;
            },
        },
    };
});

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { defaultWarpState, type WarpState } from '../../../models/WarpMarker';
import {
    __resetGainEnvelopesForTest,
    type ClipGainEnvelope,
    getEnvelope,
    setEnvelope,
} from '../../../stores/gainEnvelopeStore';
import { setWarpState, warpStates } from '../../../stores/warpStates';
import { createUndoableGlobalTimeOperation } from '../createUndoableGlobalTimeOperation';
import { executeGlobalTimeOperation } from '../executeGlobalTimeOperation';
import { setTimeOperationDependencies } from '../timeOperationDependencies';

function createClip(input: { id: string; startBeat: number; endBeat: number }) {
    return {
        id: input.id,
        trackId: 'track-1',
        name: input.id,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: 'audio' as const,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function setTracks(clips: ReturnType<typeof createClip>[]): void {
    mocks.trackState.value = {
        tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips })],
        selectedTrackId: 'track-1',
    };
    mocks.markerState.value = { markers: [], sections: [] };
    mocks.getTrackState.mockImplementation(() => mocks.trackState.value);
}

function createLane(input: { id: string; clipId?: string; beat: number }) {
    return {
        id: input.id,
        trackId: 'track-1',
        ...(input.clipId === undefined ? {} : { clipId: input.clipId }),
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [{ beat: input.beat, value: 0.5, curve: 'linear' as const, tension: 0 }],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function createGainEnvelope(clipId: string): ClipGainEnvelope {
    return {
        clipId,
        enabled: true,
        points: [{ id: `${clipId}-point`, beatOffset: 1, gainDb: -6 }],
    };
}

function createWarpState(): WarpState {
    return {
        ...defaultWarpState,
        enabled: true,
        markers: [{ id: 'warp-1', originalBeat: 0, warpedBeat: 0.5, origin: 'user', locked: false }],
    };
}

/** Only Automation runs for real; the other owners stay out of the way. */
function registerRealAutomationDependencies() {
    const idle = {
        status: 'ready' as const,
        hasChanges: false,
        replayPlan: { version: 1 as const, notes: [] },
        inversePlan: null,
        apply: () => true,
        revert: () => true,
    };
    setTimeOperationDependencies({
        prepareAutomationTimeOperation,
        prepareAutomationTimeStateRestore,
        prepareTimelineMapTimeOperation: () => idle,
        prepareTimelineMapStateRestore: () => idle,
        prepareMidiGlobalTimeTransaction: () => idle,
        prepareMidiTimeStateRestore: () => idle,
    });
}

function laneIds(): string[] {
    return getAutomationLanes().map((lane) => lane.id);
}

describe('global time operations retire per-clip satellite data', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.batchDepth = 0;
        warpStates.clear();
        __resetGainEnvelopesForTest();
        restoreAutomationSnapshot({ lanes: [] });
        setTimeOperationDependencies(null);
        setTracks([]);
    });

    it('leaves later global time operations working after deleting time over an automated clip', () => {
        setTracks([
            createClip({ id: 'automated', startBeat: 0, endBeat: 4 }),
            createClip({ id: 'keeper', startBeat: 8, endBeat: 12 }),
        ]);
        restoreAutomationSnapshot({
            lanes: [
                createLane({ id: 'lane-clip', clipId: 'automated', beat: 2 }),
                createLane({ id: 'lane-track', beat: 10 }),
            ],
        });
        registerRealAutomationDependencies();

        const deleted = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 0, endBeat: 4 } });
        expect(deleted.status).toBe('applied');

        // Before the fix the deleted clip's lane survived, and every later
        // global time operation aborted on Automation's orphaned-lane check.
        const inserted = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 0, durationBeats: 4 } });
        expect(inserted.status).toBe('applied');

        const duplicated = executeGlobalTimeOperation({ operation: { type: 'duplicate', startBeat: 8, endBeat: 12 } });
        expect(duplicated.status).toBe('applied');
    });

    it('removes the automation lane, gain envelope, and warp state of a deleted clip', () => {
        setTracks([
            createClip({ id: 'automated', startBeat: 0, endBeat: 4 }),
            createClip({ id: 'keeper', startBeat: 8, endBeat: 12 }),
        ]);
        restoreAutomationSnapshot({
            lanes: [
                createLane({ id: 'lane-clip', clipId: 'automated', beat: 2 }),
                createLane({ id: 'lane-keeper', clipId: 'keeper', beat: 10 }),
                createLane({ id: 'lane-track', beat: 10 }),
            ],
        });
        setEnvelope('automated', createGainEnvelope('automated'));
        setEnvelope('keeper', createGainEnvelope('keeper'));
        setWarpState('automated', createWarpState());
        setWarpState('keeper', createWarpState());
        registerRealAutomationDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 0, endBeat: 4 } });

        expect(result.status).toBe('applied');
        expect(laneIds()).toEqual(['lane-keeper', 'lane-track']);
        expect(getEnvelope('automated')).toBeUndefined();
        expect(warpStates.has('automated')).toBe(false);
        expect(getEnvelope('keeper')).toEqual(createGainEnvelope('keeper'));
        expect(warpStates.get('keeper')).toEqual(createWarpState());
    });

    it('retires the satellites of a clip the delete re-identifies', () => {
        setTracks([createClip({ id: 'straddler', startBeat: 4, endBeat: 12 })]);
        restoreAutomationSnapshot({
            lanes: [
                createLane({ id: 'lane-clip', clipId: 'straddler', beat: 10 }),
                createLane({ id: 'lane-track', beat: 10 }),
            ],
        });
        setEnvelope('straddler', createGainEnvelope('straddler'));
        setWarpState('straddler', createWarpState());
        registerRealAutomationDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 0, endBeat: 8 } });

        expect(result.status).toBe('applied');
        const survivingTracks = mocks.trackState.value as { tracks: Array<{ clips: Array<{ id: string }> }> };
        expect(survivingTracks.tracks[0]?.clips[0]?.id).not.toBe('straddler');
        expect(laneIds()).toEqual(['lane-track']);
        expect(getEnvelope('straddler')).toBeUndefined();
        expect(warpStates.has('straddler')).toBe(false);
    });

    it('restores every retired satellite on undo and retires them again on redo', () => {
        setTracks([
            createClip({ id: 'automated', startBeat: 0, endBeat: 4 }),
            createClip({ id: 'keeper', startBeat: 8, endBeat: 12 }),
        ]);
        restoreAutomationSnapshot({
            lanes: [
                createLane({ id: 'lane-clip', clipId: 'automated', beat: 2 }),
                createLane({ id: 'lane-track', beat: 10 }),
            ],
        });
        setEnvelope('automated', createGainEnvelope('automated'));
        setWarpState('automated', createWarpState());
        registerRealAutomationDependencies();

        const initialResult = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 0, endBeat: 4 } });
        expect(initialResult.status).toBe('applied');
        if (initialResult.status !== 'applied') {
            throw new Error('Expected an applied delete');
        }
        const transaction = createUndoableGlobalTimeOperation({ initialResult });

        transaction.undo();

        expect(laneIds()).toEqual(['lane-clip', 'lane-track']);
        expect(getAutomationLanes()[0]?.points[0]?.beat).toBe(2);
        expect(getEnvelope('automated')).toEqual(createGainEnvelope('automated'));
        expect(warpStates.get('automated')).toEqual(createWarpState());

        transaction.redo();

        expect(laneIds()).toEqual(['lane-track']);
        expect(getEnvelope('automated')).toBeUndefined();
        expect(warpStates.has('automated')).toBe(false);
    });

    it('leaves satellites untouched when the operation retires no clip id', () => {
        setTracks([createClip({ id: 'keeper', startBeat: 8, endBeat: 12 })]);
        restoreAutomationSnapshot({ lanes: [createLane({ id: 'lane-keeper', clipId: 'keeper', beat: 10 })] });
        setEnvelope('keeper', createGainEnvelope('keeper'));
        setWarpState('keeper', createWarpState());
        registerRealAutomationDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 0, durationBeats: 4 } });

        expect(result.status).toBe('applied');
        expect(laneIds()).toEqual(['lane-keeper']);
        expect(getEnvelope('keeper')).toEqual(createGainEnvelope('keeper'));
        expect(warpStates.get('keeper')).toEqual(createWarpState());
    });
});
