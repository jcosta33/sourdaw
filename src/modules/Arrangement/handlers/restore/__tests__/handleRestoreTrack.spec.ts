import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRestoreTrack } from '../handleRestoreTrack';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackState: vi.fn(),
    automationStoreValue: { value: null } as any,
    automationStoreSet: vi.fn(),
    midiStoreValue: { value: null } as any,
    midiStoreSet: vi.fn(),
    takeLaneStoreValue: { value: null } as any,
    takeLaneStoreSet: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: {
        get value() { return mocks.automationStoreValue.value; },
        set: mocks.automationStoreSet,
    }
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() { return mocks.midiStoreValue.value; },
        set: mocks.midiStoreSet,
    }
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() { return mocks.takeLaneStoreValue.value; },
        set: mocks.takeLaneStoreSet,
    }
}));

describe('handleRestoreTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue = { value: null };
        mocks.automationStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        mocks.takeLaneStoreValue.value = null;
    });

    it('restores track snapshot to track store', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        handleRestoreTrack.execute({
            type: 'restoreTrack',
            payload: {
                trackSnapshot: { id: 't1' },
                automationLaneSnapshots: [],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
                takeLaneSnapshots: [],
            },
        });

        expect(mocks.setTrackState).toHaveBeenCalledWith({ tracks: [{ id: 't1' }] });
    });

    it('restores automation lanes if present', () => {
        mocks.automationStoreValue.value = { lanes: [] };

        handleRestoreTrack.execute({
            type: 'restoreTrack',
            payload: {
                trackSnapshot: { id: 't1' },
                automationLaneSnapshots: [{ id: 'l1' }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
                takeLaneSnapshots: [],
            },
        });

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({ lanes: [{ id: 'l1' }] });
    });

    it('restores midi data if present', () => {
        mocks.midiStoreValue.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };

        handleRestoreTrack.execute({
            type: 'restoreTrack',
            payload: {
                trackSnapshot: { id: 't1' },
                automationLaneSnapshots: [],
                midiNotesByClipId: { c1: [] },
                midiCcByClipId: { c1: [] },
                midiPitchBendByClipId: { c1: [] },
                takeLaneSnapshots: [],
            },
        });

        expect(mocks.midiStoreSet).toHaveBeenCalledWith({
            notesByClipId: { c1: [] },
            ccByClipId: { c1: [] },
            pitchBendByClipId: { c1: [] },
        });
    });

    it('restores take lanes if present', () => {
        mocks.takeLaneStoreValue.value = { lanes: [] };

        handleRestoreTrack.execute({
            type: 'restoreTrack',
            payload: {
                trackSnapshot: { id: 't1' },
                automationLaneSnapshots: [],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
                takeLaneSnapshots: [{ id: 'take1' }],
            },
        });

        expect(mocks.takeLaneStoreSet).toHaveBeenCalledWith({ lanes: [{ id: 'take1' }] });
    });

    it('provides a description', () => {
        const desc = handleRestoreTrack.describe({ type: 'restoreTrack', payload: {} as any });
        expect(desc.label).toBe('Restore track');
    });

    it('is not undoable', () => {
        expect(handleRestoreTrack.undoable).toBe(false);
    });
});
