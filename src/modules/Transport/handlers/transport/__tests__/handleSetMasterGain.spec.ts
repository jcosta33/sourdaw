import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return mockValue;
        },
    },
}));

vi.mock('../../../useCases/replaceMasterGain', () => ({
    replaceMasterGain: vi.fn(),
}));

vi.mock('../toMasterGainExecutionResult', () => ({
    toMasterGainExecutionResult: vi.fn((didWrite: boolean) =>
        didWrite ? { status: 'written' } : { status: 'conflict' }
    ),
}));

import { replaceMasterGain } from '../../../useCases/replaceMasterGain';
import { handleSetMasterGain } from '../handleSetMasterGain';

const mockedReplace = vi.mocked(replaceMasterGain);

let mockValue: { masterGain: number } | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    mockValue = null;
});

describe('handleSetMasterGain — execute', () => {
    it('returns no-write when store is null', () => {
        mockValue = null;
        const result = handleSetMasterGain.execute({ type: 'setMasterGain', payload: { gain: 0.8 } });
        expect(result).toEqual({ status: 'no-write' });
        expect(mockedReplace).not.toHaveBeenCalled();
    });

    it('calls replaceMasterGain with expected and replacement when store has gain', () => {
        mockValue = { masterGain: 50 };
        mockedReplace.mockReturnValue(true);
        handleSetMasterGain.execute({ type: 'setMasterGain', payload: { gain: 0.8 } });
        expect(mockedReplace).toHaveBeenCalledWith({ expectedPercent: 50, replacementPercent: 80 });
    });

    it('returns written when replaceMasterGain succeeds', () => {
        mockValue = { masterGain: 50 };
        mockedReplace.mockReturnValue(true);
        const result = handleSetMasterGain.execute({ type: 'setMasterGain', payload: { gain: 0.8 } });
        expect(result).toEqual({ status: 'written' });
    });
});

describe('handleSetMasterGain — describe', () => {
    it('returns inverse restoreMasterGain with swapped values', () => {
        mockValue = { masterGain: 50 };
        const result = handleSetMasterGain.describe({ type: 'setMasterGain', payload: { gain: 0.8 } });
        expect(result.label).toBe('Set master gain');
        expect(result.inverseAction?.type).toBe('restoreMasterGain');
        const invPayload = (
            result.inverseAction as { payload: { expectedPercent: number; replacementPercent: number } }
        ).payload;
        expect(invPayload.expectedPercent).toBe(80);
        expect(invPayload.replacementPercent).toBe(50);
    });

    it('returns null inverse when store is null', () => {
        mockValue = null;
        const result = handleSetMasterGain.describe({ type: 'setMasterGain', payload: { gain: 0.8 } });
        expect(result.inverseAction).toBeNull();
    });

    it('returns redo restoreMasterGain action', () => {
        mockValue = { masterGain: 50 };
        const result = handleSetMasterGain.describe({ type: 'setMasterGain', payload: { gain: 0.8 } });
        expect(result.redoAction?.type).toBe('restoreMasterGain');
        const redoPayload = (result.redoAction as { payload: { expectedPercent: number; replacementPercent: number } })
            .payload;
        expect(redoPayload.expectedPercent).toBe(50);
        expect(redoPayload.replacementPercent).toBe(80);
    });
});

describe('handleSetMasterGain — isNoop', () => {
    it('returns true when gain already matches', () => {
        mockValue = { masterGain: 80 };
        expect(handleSetMasterGain.isNoop!({ type: 'setMasterGain', payload: { gain: 0.8 } })).toBe(true);
    });

    it('returns false when gain differs', () => {
        mockValue = { masterGain: 50 };
        expect(handleSetMasterGain.isNoop!({ type: 'setMasterGain', payload: { gain: 0.8 } })).toBe(false);
    });

    it('returns false when store is null', () => {
        mockValue = null;
        expect(handleSetMasterGain.isNoop!({ type: 'setMasterGain', payload: { gain: 0.8 } })).toBe(false);
    });
});
