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

    it('conflicts without writing when the fader moved since the caller read expectedPercent', () => {
        // The caller derived 0.8 from a master it read at 80%; by admission the
        // fader is at 50%. Overwriting would silently discard that move.
        mockValue = { masterGain: 50 };
        mockedReplace.mockReturnValue(true);
        const result = handleSetMasterGain.execute({
            type: 'setMasterGain',
            payload: { gain: 0.8, expectedPercent: 80 },
        });
        expect(result).toEqual({ status: 'conflict' });
        expect(mockedReplace).not.toHaveBeenCalled();
    });

    it('writes when the carried expectedPercent still matches the live percent', () => {
        mockValue = { masterGain: 80 };
        mockedReplace.mockReturnValue(true);
        const result = handleSetMasterGain.execute({
            type: 'setMasterGain',
            payload: { gain: 0.5, expectedPercent: 80 },
        });
        expect(mockedReplace).toHaveBeenCalledWith({ expectedPercent: 80, replacementPercent: 50 });
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

    it('returns false when the guard diverges even though the target already matches', () => {
        // Swallowing this as a no-op would hide the divergence instead of
        // letting execute report it as a conflict.
        mockValue = { masterGain: 80 };
        expect(
            handleSetMasterGain.isNoop!({ type: 'setMasterGain', payload: { gain: 0.8, expectedPercent: 50 } })
        ).toBe(false);
    });
});
