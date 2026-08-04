import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/setSoloSafe', () => ({
    setSoloSafe: vi.fn(),
}));

vi.mock('../toSoloStateExecutionResult', () => ({
    toSoloStateExecutionResult: vi.fn((changed: boolean) => (changed ? { status: 'written' } : { status: 'no-write' })),
}));

import { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import { setSoloSafe } from '../../../useCases/toggleTrackState/setSoloSafe';
import { handleSetSoloSafe } from '../setSoloSafe';

const mockedGetState = vi.mocked(getTrackStoreState);
const mockedSetSoloSafe = vi.mocked(setSoloSafe);

function setTrack(soloSafe: boolean | null) {
    if (soloSafe === null) {
        mockedGetState.mockReturnValue(null);
    } else {
        mockedGetState.mockReturnValue({ tracks: [{ id: 't1', soloSafe }] } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    mockedSetSoloSafe.mockReturnValue(true);
});

describe('handleSetSoloSafe — execute', () => {
    it('calls setSoloSafe with trackId, soloSafe, deferRuntimeEffect=true', () => {
        handleSetSoloSafe.execute({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: true } });
        expect(mockedSetSoloSafe).toHaveBeenCalledWith({ trackId: 't1', soloSafe: true, deferRuntimeEffect: true });
    });
});

describe('handleSetSoloSafe — describe', () => {
    it('returns "Enable solo safe" when enabling', () => {
        setTrack(false);
        const result = handleSetSoloSafe.describe({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: true } });
        expect(result.label).toBe('Enable solo safe');
    });

    it('returns "Disable solo safe" when disabling', () => {
        setTrack(true);
        const result = handleSetSoloSafe.describe({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: false } });
        expect(result.label).toBe('Disable solo safe');
    });

    it('returns inverse restoreSoloSafe with swapped expected/replacement', () => {
        setTrack(false);
        const result = handleSetSoloSafe.describe({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: true } });
        expect(result.inverseAction?.type).toBe('restoreSoloSafe');
        const payload = (result.inverseAction as { payload: { expected: boolean; replacement: boolean } }).payload;
        expect(payload.expected).toBe(true);
        expect(payload.replacement).toBe(false);
    });

    it('returns null inverse when track not found', () => {
        setTrack(null);
        const result = handleSetSoloSafe.describe({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: true } });
        expect(result.inverseAction).toBeNull();
    });

    it('returns redo restoreSoloSafe', () => {
        setTrack(false);
        const result = handleSetSoloSafe.describe({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: true } });
        expect(result.redoAction?.type).toBe('restoreSoloSafe');
    });
});

describe('handleSetSoloSafe — isNoop', () => {
    it('returns true when already matches', () => {
        setTrack(true);
        expect(handleSetSoloSafe.isNoop!({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: true } })).toBe(
            true
        );
    });

    it('returns false when differs', () => {
        setTrack(false);
        expect(handleSetSoloSafe.isNoop!({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: true } })).toBe(
            false
        );
    });

    it('returns false when store is null', () => {
        setTrack(null);
        expect(handleSetSoloSafe.isNoop!({ type: 'setSoloSafe', payload: { trackId: 't1', soloSafe: true } })).toBe(
            false
        );
    });
});
