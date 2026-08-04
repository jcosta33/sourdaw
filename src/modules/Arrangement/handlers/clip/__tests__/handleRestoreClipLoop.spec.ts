import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/clipLoop/setClipLoop', () => ({
    setClipLoop: vi.fn(),
}));

vi.mock('../../toHandlerExecutionResult', () => ({
    toHandlerExecutionResult: vi.fn((didWrite: boolean) => (didWrite ? { status: 'written' } : { status: 'no-write' })),
}));

import { setClipLoop } from '../../../useCases/clipLoop/setClipLoop';
import { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import { handleRestoreClipLoop } from '../handleRestoreClipLoop';

const mockedGetState = vi.mocked(getTrackStoreState);
const mockedSetLoop = vi.mocked(setClipLoop);

function setClip(clip: Record<string, unknown> | null) {
    if (clip === null) {
        mockedGetState.mockReturnValue(null);
    } else {
        mockedGetState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRestoreClipLoop — execute', () => {
    it('writes when expected matches current', () => {
        setClip({ id: 'c1', loopEnabled: true });
        mockedSetLoop.mockReturnValue(true);
        const result = handleRestoreClipLoop.execute({
            type: 'restoreClipLoop',
            payload: {
                clipId: 'c1',
                expected: { present: true, enabled: true },
                replacement: { present: true, enabled: false },
            },
        });
        expect(result).toEqual({ status: 'written' });
        expect(mockedSetLoop).toHaveBeenCalledWith('c1', false);
    });

    it('returns conflict when expected does not match', () => {
        setClip({ id: 'c1', loopEnabled: false });
        const result = handleRestoreClipLoop.execute({
            type: 'restoreClipLoop',
            payload: {
                clipId: 'c1',
                expected: { present: true, enabled: true },
                replacement: { present: true, enabled: false },
            },
        });
        expect(result).toEqual({ status: 'conflict' });
        expect(mockedSetLoop).not.toHaveBeenCalled();
    });

    it('returns conflict when clip not found', () => {
        setClip(null);
        const result = handleRestoreClipLoop.execute({
            type: 'restoreClipLoop',
            payload: {
                clipId: 'missing',
                expected: { present: false, enabled: false },
                replacement: { present: true, enabled: true },
            },
        });
        expect(result).toEqual({ status: 'conflict' });
    });

    it('passes undefined when replacement.present is false', () => {
        setClip({ id: 'c1', loopEnabled: undefined });
        mockedSetLoop.mockReturnValue(true);
        handleRestoreClipLoop.execute({
            type: 'restoreClipLoop',
            payload: {
                clipId: 'c1',
                expected: { present: false, enabled: false },
                replacement: { present: false, enabled: false },
            },
        });
        expect(mockedSetLoop).toHaveBeenCalledWith('c1', undefined);
    });
});

describe('handleRestoreClipLoop — isNoop', () => {
    it('returns false when clip not found', () => {
        setClip(null);
        expect(
            handleRestoreClipLoop.isNoop!({
                type: 'restoreClipLoop',
                payload: {
                    clipId: 'c1',
                    expected: { present: true, enabled: true },
                    replacement: { present: true, enabled: true },
                },
            })
        ).toBe(false);
    });

    it('returns true when replacement matches current', () => {
        setClip({ id: 'c1', loopEnabled: true });
        expect(
            handleRestoreClipLoop.isNoop!({
                type: 'restoreClipLoop',
                payload: {
                    clipId: 'c1',
                    expected: { present: true, enabled: true },
                    replacement: { present: true, enabled: true },
                },
            })
        ).toBe(true);
    });

    it('returns false when replacement differs', () => {
        setClip({ id: 'c1', loopEnabled: false });
        expect(
            handleRestoreClipLoop.isNoop!({
                type: 'restoreClipLoop',
                payload: {
                    clipId: 'c1',
                    expected: { present: true, enabled: false },
                    replacement: { present: true, enabled: true },
                },
            })
        ).toBe(false);
    });
});

describe('handleRestoreClipLoop — describe', () => {
    it('returns label with null inverse', () => {
        const result = handleRestoreClipLoop.describe({
            type: 'restoreClipLoop',
            payload: {
                clipId: 'c1',
                expected: { present: true, enabled: true },
                replacement: { present: true, enabled: false },
            },
        });
        expect(result.label).toBe('Restore clip loop state');
        expect(result.inverseAction).toBeNull();
    });
});
