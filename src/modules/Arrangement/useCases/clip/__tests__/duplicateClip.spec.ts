import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Clip } from '../../../models/Track';
import * as subject from '../duplicateClip';

const mocks = vi.hoisted(() => ({
    duplicateClipCore: vi.fn<(input: unknown) => boolean>(),
}));

vi.mock('../duplicateClipCore', () => ({
    duplicateClipCore: mocks.duplicateClipCore,
}));

describe('duplicateClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.duplicateClipCore.mockReturnValue(true);
    });

    it('places the copy immediately after the source clip end beat when given a clip id', () => {
        const sourceClip: Clip = {
            id: 'src',
            trackId: 't1',
            name: 'loop',
            startBeat: 4,
            endBeat: 8,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#fff',
            locked: false,
            muted: false,
        };

        const result = subject.duplicateClip('src');

        const input = mocks.duplicateClipCore.mock.calls[0]?.[0] as {
            clipId: string;
            targetClipId?: string;
            computeStartBeat: (clip: Clip) => number;
        };
        expect(input.clipId).toBe('src');
        expect(input.targetClipId).toBeUndefined();
        // The new clip starts exactly where the source ends: contiguous copy.
        expect(input.computeStartBeat(sourceClip)).toBe(8);
        expect(result).toBe(true);
    });

    it('forwards a caller-supplied target clip id when given an object', () => {
        subject.duplicateClip({ clipId: 'src', targetClipId: 'dest-1' });

        const input = mocks.duplicateClipCore.mock.calls[0]?.[0] as {
            clipId: string;
            targetClipId?: string;
        };
        expect(input.clipId).toBe('src');
        expect(input.targetClipId).toBe('dest-1');
    });

    it('leaves target clip id unset when the object form omits it', () => {
        subject.duplicateClip({ clipId: 'src' });

        const input = mocks.duplicateClipCore.mock.calls[0]?.[0] as {
            clipId: string;
            targetClipId?: string;
        };
        expect(input.clipId).toBe('src');
        expect(input.targetClipId).toBeUndefined();
    });

    it('surfaces the write result from the core duplicator', () => {
        mocks.duplicateClipCore.mockReturnValue(false);

        expect(subject.duplicateClip('src')).toBe(false);
    });
});
