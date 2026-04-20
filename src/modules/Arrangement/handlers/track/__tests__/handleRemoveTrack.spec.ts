import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveTrack } from '../handleRemoveTrack';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    removeTrack: vi.fn(),
    automationStoreValue: { value: null } as any,
    midiStoreValue: { value: null } as any,
    takeLaneStoreValue: { value: null } as any,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: mocks.removeTrack,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: {
        get value() {
            return mocks.automationStoreValue.value;
        },
    },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
    },
}));

describe('handleRemoveTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.automationStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        mocks.takeLaneStoreValue.value = null;
    });

    describe('execute', () => {
        it('calls removeTrack with the provided trackId', () => {
            handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });
            expect(mocks.removeTrack).toHaveBeenCalledWith('t1');
        });
    });

    describe('describe', () => {
        it('returns simple label if track is not found', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleRemoveTrack.describe({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            expect(desc.label).toBe('Remove track');
            expect((desc as any).inverseAction).toBeUndefined();
        });

        it('returns inverse action with full snapshot state', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', name: 'Vocals', clips: [{ id: 'c1' }] }],
            });

            mocks.automationStoreValue.value = {
                lanes: [
                    { trackId: 't1', id: 'l1' },
                    { trackId: 't2', id: 'l2' },
                ],
            };

            mocks.midiStoreValue.value = {
                notesByClipId: { c1: [{ pitch: 60 }] },
                ccByClipId: { c1: [{ value: 10 }] },
                pitchBendByClipId: { c1: [{ value: 0 }] },
                c2: [{ pitch: 64 }],
            };

            mocks.takeLaneStoreValue.value = {
                lanes: [
                    { trackId: 't1', id: 'take1' },
                    { trackId: 't2', id: 'take2' },
                ],
            };

            const desc = handleRemoveTrack.describe({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            expect(desc.label).toBe('Remove track');
            expect(desc.inverseAction).toBeDefined();
            expect(desc.inverseAction?.type).toBe('restoreTrack');

            const payload = desc.inverseAction?.payload;
            expect(payload?.trackId).toBe('t1');
            expect(payload?.trackSnapshot).toEqual({ id: 't1', name: 'Vocals', clips: [{ id: 'c1' }] });
            expect(payload?.automationLaneSnapshots).toEqual([{ trackId: 't1', id: 'l1' }]);
            expect(payload?.takeLaneSnapshots).toEqual([{ trackId: 't1', id: 'take1' }]);

            expect(payload?.midiNotesByClipId).toEqual({ c1: [{ pitch: 60 }] });
            expect(payload?.midiCcByClipId).toEqual({ c1: [{ value: 10 }] });
            expect(payload?.midiPitchBendByClipId).toEqual({ c1: [{ value: 0 }] });
        });
    });

    it('is undoable', () => {
        expect(handleRemoveTrack.undoable).toBe(true);
    });
});
