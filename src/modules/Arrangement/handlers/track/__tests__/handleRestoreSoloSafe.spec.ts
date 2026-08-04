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
import { handleRestoreSoloSafe } from '../restoreSoloSafe';

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

describe('handleRestoreSoloSafe — execute', () => {
    it('writes when expected matches current', () => {
        setTrack(true);
        const result = handleRestoreSoloSafe.execute({
            type: 'restoreSoloSafe',
            payload: { trackId: 't1', expected: true, replacement: false },
        });
        expect(result).toEqual({ status: 'written' });
        expect(mockedSetSoloSafe).toHaveBeenCalledWith({ trackId: 't1', soloSafe: false, deferRuntimeEffect: true });
    });

    it('returns conflict when expected does not match', () => {
        setTrack(false);
        const result = handleRestoreSoloSafe.execute({
            type: 'restoreSoloSafe',
            payload: { trackId: 't1', expected: true, replacement: false },
        });
        expect(result).toEqual({ status: 'conflict' });
        expect(mockedSetSoloSafe).not.toHaveBeenCalled();
    });

    it('returns conflict when track not found', () => {
        setTrack(null);
        const result = handleRestoreSoloSafe.execute({
            type: 'restoreSoloSafe',
            payload: { trackId: 't1', expected: true, replacement: false },
        });
        expect(result).toEqual({ status: 'conflict' });
    });
});

describe('handleRestoreSoloSafe — isNoop', () => {
    it('returns true when replacement matches current', () => {
        setTrack(true);
        expect(
            handleRestoreSoloSafe.isNoop!({
                type: 'restoreSoloSafe',
                payload: { trackId: 't1', expected: true, replacement: true },
            })
        ).toBe(true);
    });

    it('returns false when replacement differs', () => {
        setTrack(false);
        expect(
            handleRestoreSoloSafe.isNoop!({
                type: 'restoreSoloSafe',
                payload: { trackId: 't1', expected: false, replacement: true },
            })
        ).toBe(false);
    });
});

describe('handleRestoreSoloSafe — describe', () => {
    it('returns label with null inverse', () => {
        const result = handleRestoreSoloSafe.describe({
            type: 'restoreSoloSafe',
            payload: { trackId: 't1', expected: true, replacement: false },
        });
        expect(result.label).toBe('Restore solo-safe state');
        expect(result.inverseAction).toBeNull();
    });
});
