import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRestoreTrack } from '../handleRestoreTrack';

import type { TakeLaneStoreState } from '../../../stores/takeLaneStore';
import type { TrackStoreState } from '../../../stores/trackStore';
import type { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import type { setTrackState } from '../../../useCases/setTrackState';

type RestoreTrackAction = Parameters<typeof handleRestoreTrack.execute>[0];
type RestoreTrackPayload = RestoreTrackAction['payload'];
type RestoreMidiClipDataInput = {
    clipId: string;
    notesSnapshot: RestoreTrackPayload['midiNotesByClipId'][string] | null;
    controlChangeSnapshot: RestoreTrackPayload['midiCcByClipId'][string] | null;
    pitchBendSnapshot: RestoreTrackPayload['midiPitchBendByClipId'][string] | null;
};

const mocks = vi.hoisted(() => {
    const takeLaneStoreState: { value: TakeLaneStoreState | null } = { value: null };

    return {
        takeLaneStoreState,
        getTrackStoreState: vi.fn<typeof getTrackStoreState>(),
        setTrackState: vi.fn<typeof setTrackState>(),
        restoreAutomationLanes: vi.fn<(laneSnapshots: readonly unknown[]) => void>(),
        restoreMidiClipData: vi.fn<(input: RestoreMidiClipDataInput) => void>(),
        getTakeLaneStoreValue: vi.fn((): TakeLaneStoreState | null => takeLaneStoreState.value),
        setTakeLaneStore: vi.fn((nextState: TakeLaneStoreState): void => {
            takeLaneStoreState.value = nextState;
        }),
    };
});

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    restoreAutomationLanes: mocks.restoreAutomationLanes,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    restoreMidiClipData: mocks.restoreMidiClipData,
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value(): TakeLaneStoreState | null {
            return mocks.getTakeLaneStoreValue();
        },
        set: mocks.setTakeLaneStore,
    },
}));

function createRestoreTrackAction(overrides: Partial<RestoreTrackPayload> = {}): RestoreTrackAction {
    return {
        type: 'restoreTrack',
        payload: {
            trackId: 'track-1',
            trackSnapshot: { id: 'track-1' },
            automationLaneSnapshots: [],
            midiNotesByClipId: {},
            midiCcByClipId: {},
            midiPitchBendByClipId: {},
            takeLaneSnapshots: [],
            ...overrides,
        },
    };
}

function requireCallOrder(callOrders: readonly number[], label: string): number {
    const callOrder = callOrders[0];
    if (callOrder === undefined) {
        throw new Error(`Expected ${label} to be called`);
    }

    return callOrder;
}

describe('handleRestoreTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.takeLaneStoreState.value = { lanes: [] };
    });

    it('should restore track, automation, MIDI, and take lanes in owner order', () => {
        const trackState: TrackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        const automationLaneSnapshots = [
            { id: 'lane-restored', trackId: 'track-1' },
        ] satisfies RestoreTrackPayload['automationLaneSnapshots'];
        const action = createRestoreTrackAction({
            automationLaneSnapshots,
            midiNotesByClipId: { 'clip-a': [], 'clip-b': [] },
            midiCcByClipId: { 'clip-a': [], 'clip-c': [] },
            midiPitchBendByClipId: { 'clip-b': [], 'clip-d': [] },
            takeLaneSnapshots: [{ id: 'take-restored', trackId: 'track-1' }],
        });
        mocks.getTrackStoreState.mockReturnValue(trackState);

        void handleRestoreTrack.execute(action);

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            ...trackState,
            tracks: [action.payload.trackSnapshot],
        });
        expect(mocks.restoreAutomationLanes).toHaveBeenCalledWith(action.payload.automationLaneSnapshots);
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(1, {
            clipId: 'clip-a',
            notesSnapshot: action.payload.midiNotesByClipId['clip-a'],
            controlChangeSnapshot: action.payload.midiCcByClipId['clip-a'],
            pitchBendSnapshot: null,
        });
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(2, {
            clipId: 'clip-b',
            notesSnapshot: action.payload.midiNotesByClipId['clip-b'],
            controlChangeSnapshot: null,
            pitchBendSnapshot: action.payload.midiPitchBendByClipId['clip-b'],
        });
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(3, {
            clipId: 'clip-c',
            notesSnapshot: null,
            controlChangeSnapshot: action.payload.midiCcByClipId['clip-c'],
            pitchBendSnapshot: null,
        });
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(4, {
            clipId: 'clip-d',
            notesSnapshot: null,
            controlChangeSnapshot: null,
            pitchBendSnapshot: action.payload.midiPitchBendByClipId['clip-d'],
        });
        expect(mocks.setTakeLaneStore).toHaveBeenCalledWith({ lanes: action.payload.takeLaneSnapshots });

        const trackOrder = requireCallOrder(mocks.setTrackState.mock.invocationCallOrder, 'track restore');
        const automationOrder = requireCallOrder(
            mocks.restoreAutomationLanes.mock.invocationCallOrder,
            'automation restore'
        );
        const midiCallOrders = mocks.restoreMidiClipData.mock.invocationCallOrder;
        const midiOrder = requireCallOrder(midiCallOrders, 'MIDI restore');
        const finalMidiOrder = midiCallOrders.at(-1);
        if (finalMidiOrder === undefined) {
            throw new Error('Expected final MIDI restore call');
        }
        const takeLaneOrder = requireCallOrder(mocks.setTakeLaneStore.mock.invocationCallOrder, 'take-lane restore');

        expect(trackOrder).toBeLessThan(automationOrder);
        expect(automationOrder).toBeLessThan(midiOrder);
        expect(finalMidiOrder).toBeLessThan(takeLaneOrder);
    });

    it('should not call owners or write local state when every snapshot is empty', () => {
        void handleRestoreTrack.execute(createRestoreTrackAction());

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.restoreAutomationLanes).not.toHaveBeenCalled();
        expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        expect(mocks.setTakeLaneStore).not.toHaveBeenCalled();
    });

    it('should provide a description and remain non-undoable', () => {
        expect(handleRestoreTrack.describe(createRestoreTrackAction())).toEqual({ label: 'Restore track' });
        expect(handleRestoreTrack.undoable).toBe(false);
    });
});
