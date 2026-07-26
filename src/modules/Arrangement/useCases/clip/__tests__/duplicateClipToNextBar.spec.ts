import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Clip } from '../../../models/Track';
import * as subject from '../duplicateClipToNextBar';

const mocks = vi.hoisted(() => {
    // `value` is deliberately nullable: one test drives it to undefined to
    // exercise the 4-beat bar fallback.
    const transportStore: { value: { timeSignatureNumerator: number } | undefined } = {
        value: { timeSignatureNumerator: 4 },
    };
    return {
        duplicateClipCore: vi.fn<(input: unknown) => boolean>(),
        transportStore,
    };
});

vi.mock('../duplicateClipCore', () => ({
    duplicateClipCore: mocks.duplicateClipCore,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportStore.value;
        },
    },
}));

function makeClip(endBeat: number): Clip {
    return {
        id: 'src',
        trackId: 't1',
        name: 'loop',
        startBeat: 0,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
    };
}

describe('duplicateClipToNextBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.duplicateClipCore.mockReturnValue(true);
        mocks.transportStore.value = { timeSignatureNumerator: 4 };
    });

    it('snaps the copy start to the next bar boundary aligned to the time signature', () => {
        // A clip ending at beat 6 under 4/4 should jump to beat 8 (next bar).
        const sourceClip = makeClip(6);

        subject.duplicateClipToNextBar('src');

        const input = mocks.duplicateClipCore.mock.calls[0]?.[0] as {
            clipId: string;
            targetClipId?: string;
            computeStartBeat: (clip: Clip) => number;
        };
        expect(input.clipId).toBe('src');
        expect(input.targetClipId).toBeUndefined();
        expect(input.computeStartBeat(sourceClip)).toBe(8);
    });

    it('keeps an already bar-aligned clip start at the same bar when it ends exactly on a bar', () => {
        const sourceClip = makeClip(8);

        subject.duplicateClipToNextBar('src');

        const input = mocks.duplicateClipCore.mock.calls[0]?.[0] as {
            computeStartBeat: (clip: Clip) => number;
        };
        expect(input.computeStartBeat(sourceClip)).toBe(8);
    });

    it('respects an odd time signature numerator for the bar grid', () => {
        // 3/4: a clip ending at beat 5 snaps to beat 6.
        mocks.transportStore.value = { timeSignatureNumerator: 3 };
        const sourceClip = makeClip(5);

        subject.duplicateClipToNextBar('src');

        const input = mocks.duplicateClipCore.mock.calls[0]?.[0] as {
            computeStartBeat: (clip: Clip) => number;
        };
        expect(input.computeStartBeat(sourceClip)).toBe(6);
    });

    it('falls back to a 4-beat bar when transport has no time signature', () => {
        mocks.transportStore.value = undefined;
        const sourceClip = makeClip(6);

        subject.duplicateClipToNextBar('src');

        const input = mocks.duplicateClipCore.mock.calls[0]?.[0] as {
            computeStartBeat: (clip: Clip) => number;
        };
        expect(input.computeStartBeat(sourceClip)).toBe(8);
    });

    it('forwards an object-form input with a target clip id', () => {
        subject.duplicateClipToNextBar({ clipId: 'src', targetClipId: 'dest-9' });

        const input = mocks.duplicateClipCore.mock.calls[0]?.[0] as {
            clipId: string;
            targetClipId?: string;
        };
        expect(input.clipId).toBe('src');
        expect(input.targetClipId).toBe('dest-9');
    });

    it('surfaces the write result from the core duplicator', () => {
        mocks.duplicateClipCore.mockReturnValue(false);

        expect(subject.duplicateClipToNextBar('src')).toBe(false);
    });
});
