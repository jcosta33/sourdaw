import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/restoreCrossfadeClips', () => ({
    restoreCrossfadeClips: vi.fn(),
}));

vi.mock('../../toHandlerExecutionResult', () => ({
    toHandlerExecutionResult: vi.fn((didWrite: boolean) => (didWrite ? { status: 'written' } : { status: 'no-write' })),
}));

import { restoreCrossfadeClips } from '../../../useCases/clipEditing/restoreCrossfadeClips';
import { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import { handleRestoreCrossfadeClips } from '../handleRestoreCrossfadeClips';

const mockedGetState = vi.mocked(getTrackStoreState);
const mockedRestore = vi.mocked(restoreCrossfadeClips);

function makeClip(id: string, overrides: Record<string, unknown> = {}) {
    return { id, endBeat: 4, startBeat: 0, fadeInBeats: 0, fadeOutBeats: 0, locked: false, ...overrides };
}

function setClips(clips: Record<string, unknown>[] | null) {
    if (clips === null) {
        mockedGetState.mockReturnValue(null);
    } else {
        mockedGetState.mockReturnValue({ tracks: [{ id: 't1', clips }] } as never);
    }
}

const matchingExpected = {
    clipAEndBeat: 4,
    clipAFadeOutBeats: 0,
    clipBStartBeat: 0,
    clipBFadeInBeats: 0,
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRestoreCrossfadeClips — execute', () => {
    it('writes when both clips found and expected matches', () => {
        setClips([makeClip('a'), makeClip('b')]);
        mockedRestore.mockReturnValue(true);
        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'a',
                clipBId: 'b',
                expected: matchingExpected,
                replacement: matchingExpected,
            },
        });
        expect(result).toEqual({ status: 'written' });
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('returns conflict when clipA not found', () => {
        setClips([makeClip('b')]);
        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: { clipAId: 'a', clipBId: 'b', expected: matchingExpected, replacement: matchingExpected },
        });
        expect(result).toEqual({ status: 'conflict' });
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('returns conflict when clipA is locked', () => {
        setClips([makeClip('a', { locked: true }), makeClip('b')]);
        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: { clipAId: 'a', clipBId: 'b', expected: matchingExpected, replacement: matchingExpected },
        });
        expect(result).toEqual({ status: 'conflict' });
    });

    it('returns conflict when expected snapshot does not match current', () => {
        setClips([makeClip('a', { endBeat: 8 }), makeClip('b')]);
        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'a',
                clipBId: 'b',
                expected: matchingExpected,
                replacement: matchingExpected,
            },
        });
        expect(result).toEqual({ status: 'conflict' });
    });
});

describe('handleRestoreCrossfadeClips — isNoop', () => {
    it('returns false when clips not found', () => {
        setClips([]);
        expect(
            handleRestoreCrossfadeClips.isNoop!({
                type: 'restoreCrossfadeClips',
                payload: { clipAId: 'a', clipBId: 'b', expected: matchingExpected, replacement: matchingExpected },
            })
        ).toBe(false);
    });

    it('returns true when replacement already matches current state', () => {
        setClips([makeClip('a'), makeClip('b')]);
        expect(
            handleRestoreCrossfadeClips.isNoop!({
                type: 'restoreCrossfadeClips',
                payload: { clipAId: 'a', clipBId: 'b', expected: matchingExpected, replacement: matchingExpected },
            })
        ).toBe(true);
    });

    it('returns false when replacement differs from current', () => {
        setClips([makeClip('a', { endBeat: 8 }), makeClip('b')]);
        expect(
            handleRestoreCrossfadeClips.isNoop!({
                type: 'restoreCrossfadeClips',
                payload: { clipAId: 'a', clipBId: 'b', expected: matchingExpected, replacement: matchingExpected },
            })
        ).toBe(false);
    });
});

describe('handleRestoreCrossfadeClips — describe', () => {
    it('returns label with null inverse', () => {
        const result = handleRestoreCrossfadeClips.describe({
            type: 'restoreCrossfadeClips',
            payload: { clipAId: 'a', clipBId: 'b', expected: matchingExpected, replacement: matchingExpected },
        });
        expect(result.label).toBe('Restore crossfade clips');
        expect(result.inverseAction).toBeNull();
    });
});
