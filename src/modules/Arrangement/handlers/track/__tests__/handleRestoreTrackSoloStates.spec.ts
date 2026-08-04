import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/restoreTrackSoloStates', () => ({
    restoreTrackSoloStates: vi.fn(),
}));

vi.mock('../toSoloStateExecutionResult', () => ({
    toSoloStateExecutionResult: vi.fn((changed: boolean) => (changed ? { status: 'written' } : { status: 'no-write' })),
}));

import { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import { restoreTrackSoloStates } from '../../../useCases/toggleTrackState/restoreTrackSoloStates';
import { handleRestoreTrackSoloStates } from '../restoreTrackSoloStates';

const mockedGetState = vi.mocked(getTrackStoreState);
const mockedRestore = vi.mocked(restoreTrackSoloStates);

function setTracks(tracks: Array<{ id: string; soloed: boolean }> | null) {
    if (tracks === null) {
        mockedGetState.mockReturnValue(null);
    } else {
        mockedGetState.mockReturnValue({ tracks } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    mockedRestore.mockReturnValue(true);
});

describe('handleRestoreTrackSoloStates — execute', () => {
    it('writes when expected matches current', () => {
        setTracks([
            { id: 't1', soloed: true },
            { id: 't2', soloed: false },
        ]);
        const result = handleRestoreTrackSoloStates.execute({
            type: 'restoreTrackSoloStates',
            payload: {
                expected: [
                    { trackId: 't1', soloed: true },
                    { trackId: 't2', soloed: false },
                ],
                replacement: [
                    { trackId: 't1', soloed: false },
                    { trackId: 't2', soloed: true },
                ],
            },
        });
        expect(result).toEqual({ status: 'written' });
        expect(mockedRestore).toHaveBeenCalledWith({
            states: [
                { trackId: 't1', soloed: false },
                { trackId: 't2', soloed: true },
            ],
            deferRuntimeEffect: true,
        });
    });

    it('returns conflict when expected does not match', () => {
        setTracks([{ id: 't1', soloed: false }]);
        const result = handleRestoreTrackSoloStates.execute({
            type: 'restoreTrackSoloStates',
            payload: {
                expected: [{ trackId: 't1', soloed: true }],
                replacement: [{ trackId: 't1', soloed: false }],
            },
        });
        expect(result).toEqual({ status: 'conflict' });
    });

    it('returns conflict when trackIds mismatch', () => {
        setTracks([{ id: 't1', soloed: true }]);
        const result = handleRestoreTrackSoloStates.execute({
            type: 'restoreTrackSoloStates',
            payload: {
                expected: [{ trackId: 't1', soloed: true }],
                replacement: [{ trackId: 't2', soloed: false }],
            },
        });
        expect(result).toEqual({ status: 'conflict' });
    });
});

describe('handleRestoreTrackSoloStates — isNoop', () => {
    it('returns true when replacement already matches', () => {
        setTracks([{ id: 't1', soloed: true }]);
        expect(
            handleRestoreTrackSoloStates.isNoop!({
                type: 'restoreTrackSoloStates',
                payload: {
                    expected: [{ trackId: 't1', soloed: true }],
                    replacement: [{ trackId: 't1', soloed: true }],
                },
            })
        ).toBe(true);
    });

    it('returns false when replacement differs', () => {
        setTracks([{ id: 't1', soloed: true }]);
        expect(
            handleRestoreTrackSoloStates.isNoop!({
                type: 'restoreTrackSoloStates',
                payload: {
                    expected: [{ trackId: 't1', soloed: true }],
                    replacement: [{ trackId: 't1', soloed: false }],
                },
            })
        ).toBe(false);
    });
});

describe('handleRestoreTrackSoloStates — describe', () => {
    it('returns label with null inverse', () => {
        const result = handleRestoreTrackSoloStates.describe({
            type: 'restoreTrackSoloStates',
            payload: { expected: [], replacement: [] },
        });
        expect(result.label).toBe('Restore track solo states');
        expect(result.inverseAction).toBeNull();
    });
});
