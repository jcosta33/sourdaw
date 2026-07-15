import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    tempoMapStoreValue: {
        value: {
            changes: [
                { id: 'tempo-before', beat: 2, tempo: 110, curve: 'instant' },
                { id: 'tempo-at', beat: 3, tempo: 120, curve: 'linear' },
                { id: 'tempo-inside', beat: 4, tempo: 125, curve: 'instant' },
                { id: 'tempo-end', beat: 6, tempo: 130, curve: 'instant' },
                { id: 'tempo-after', beat: 8, tempo: 140, curve: 'linear' },
            ],
        },
    },
    timeSignatureMapStoreValue: {
        value: {
            changes: [
                { id: 'sig-before', beat: 2, numerator: 3, denominator: 4 },
                { id: 'sig-at', beat: 3, numerator: 4, denominator: 4 },
                { id: 'sig-inside', beat: 4, numerator: 5, denominator: 4 },
                { id: 'sig-end', beat: 6, numerator: 6, denominator: 8 },
                { id: 'sig-after', beat: 8, numerator: 7, denominator: 8 },
            ],
        },
    },
    tempoMapStoreSet: vi.fn(),
    timeSignatureMapStoreSet: vi.fn(),
}));

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return mocks.tempoMapStoreValue.value;
        },
        set: mocks.tempoMapStoreSet,
    },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return mocks.timeSignatureMapStoreValue.value;
        },
        set: mocks.timeSignatureMapStoreSet,
    },
}));

import { deleteTimelineMapsTimeRange } from '../deleteTimelineMapsTimeRange';

describe('deleteTimelineMapsTimeRange', () => {
    beforeEach(() => {
        mocks.tempoMapStoreValue.value = {
            changes: [
                { id: 'tempo-before', beat: 2, tempo: 110, curve: 'instant' },
                { id: 'tempo-at', beat: 3, tempo: 120, curve: 'linear' },
                { id: 'tempo-inside', beat: 4, tempo: 125, curve: 'instant' },
                { id: 'tempo-end', beat: 6, tempo: 130, curve: 'instant' },
                { id: 'tempo-after', beat: 8, tempo: 140, curve: 'linear' },
            ],
        };
        mocks.timeSignatureMapStoreValue.value = {
            changes: [
                { id: 'sig-before', beat: 2, numerator: 3, denominator: 4 },
                { id: 'sig-at', beat: 3, numerator: 4, denominator: 4 },
                { id: 'sig-inside', beat: 4, numerator: 5, denominator: 4 },
                { id: 'sig-end', beat: 6, numerator: 6, denominator: 8 },
                { id: 'sig-after', beat: 8, numerator: 7, denominator: 8 },
            ],
        };
        mocks.tempoMapStoreSet.mockClear();
        mocks.timeSignatureMapStoreSet.mockClear();
    });

    it('updates tempo and time-signature maps in order while preserving change identities', () => {
        deleteTimelineMapsTimeRange({ startBeat: 3, endBeat: 6 });

        expect(mocks.tempoMapStoreSet).toHaveBeenCalledExactlyOnceWith({
            changes: [
                { id: 'tempo-before', beat: 2, tempo: 110, curve: 'instant' },
                { id: 'tempo-end', beat: 3, tempo: 130, curve: 'instant' },
                { id: 'tempo-after', beat: 5, tempo: 140, curve: 'linear' },
            ],
        });
        expect(mocks.timeSignatureMapStoreSet).toHaveBeenCalledExactlyOnceWith({
            changes: [
                { id: 'sig-before', beat: 2, numerator: 3, denominator: 4 },
                { id: 'sig-end', beat: 3, numerator: 6, denominator: 8 },
                { id: 'sig-after', beat: 5, numerator: 7, denominator: 8 },
            ],
        });
        expect(mocks.tempoMapStoreSet.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.timeSignatureMapStoreSet.mock.invocationCallOrder[0]!
        );
    });

    it('skips a missing map without affecting the other owner write', () => {
        mocks.tempoMapStoreValue.value = null;

        deleteTimelineMapsTimeRange({ startBeat: 0, endBeat: 4 });

        expect(mocks.tempoMapStoreSet).not.toHaveBeenCalled();
        expect(mocks.timeSignatureMapStoreSet).toHaveBeenCalledOnce();
    });
});
