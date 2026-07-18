import { describe, it, expect, vi, beforeEach } from 'vitest';

import type * as updateClipRepo from '../../repositories/track/updateClip';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn<(typeof updateClipRepo)['updateClip']>(),
}));

vi.mock('../../../repositories/track/updateClip', () => ({ updateClip: mocks.updateClip }));

import { resetOverride } from '../resetOverride';
import { slipClipContent } from '../slipClipContent';
import { toggleInlineEditing } from '../toggleInlineEditing';

function capture_update() {
    const result: unknown[] = [];
    mocks.updateClip.mockImplementation((_id: string, fn: (c: Record<string, unknown>) => unknown) => {
        result.push(
            fn({
                overrides: { gain: 1, color: 'red' },
                audioOffsetBeats: 0,
                midiOffsetBeats: 0,
                isInlineEditing: false,
            })
        );
    });
    return result;
}

describe('resetOverride', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes property from overrides', () => {
        const result = capture_update();
        resetOverride('c1', 'gain');
        const updated = result[0] as { overrides: Record<string, unknown> };
        expect(updated.overrides.gain).toBeUndefined();
        expect(updated.overrides.color).toBe('red');
    });
});

describe('slipClipContent', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sets audioOffsetBeats for audio clips', () => {
        const result: unknown[] = [];
        mocks.updateClip.mockImplementation((_id: string, fn: (c: Record<string, unknown>) => unknown) => {
            result.push(fn({ audioOffsetBeats: 0, midiOffsetBeats: 0 }));
        });
        slipClipContent('c1', 'audio', 2.5);
        expect((result[0] as { audioOffsetBeats: number }).audioOffsetBeats).toBe(2.5);
    });

    it('sets midiOffsetBeats for midi clips', () => {
        const result: unknown[] = [];
        mocks.updateClip.mockImplementation((_id: string, fn: (c: Record<string, unknown>) => unknown) => {
            result.push(fn({ audioOffsetBeats: 0, midiOffsetBeats: 0 }));
        });
        slipClipContent('c1', 'midi', -1);
        expect((result[0] as { midiOffsetBeats: number }).midiOffsetBeats).toBe(-1);
    });
});

describe('toggleInlineEditing', () => {
    beforeEach(() => vi.clearAllMocks());

    it('toggles from false to true', () => {
        const result: unknown[] = [];
        mocks.updateClip.mockImplementation((_id: string, fn: (c: { isInlineEditing: boolean }) => unknown) => {
            result.push(fn({ isInlineEditing: false }));
        });
        toggleInlineEditing('c1');
        expect((result[0] as { isInlineEditing: boolean }).isInlineEditing).toBe(true);
    });

    it('toggles from true to false', () => {
        const result: unknown[] = [];
        mocks.updateClip.mockImplementation((_id: string, fn: (c: { isInlineEditing: boolean }) => unknown) => {
            result.push(fn({ isInlineEditing: true }));
        });
        toggleInlineEditing('c1');
        expect((result[0] as { isInlineEditing: boolean }).isInlineEditing).toBe(false);
    });

    it('forces to true when specified', () => {
        const result: unknown[] = [];
        mocks.updateClip.mockImplementation((_id: string, fn: (c: { isInlineEditing: boolean }) => unknown) => {
            result.push(fn({ isInlineEditing: false }));
        });
        toggleInlineEditing('c1', true);
        expect((result[0] as { isInlineEditing: boolean }).isInlineEditing).toBe(true);
    });

    it('forces to false when specified', () => {
        const result: unknown[] = [];
        mocks.updateClip.mockImplementation((_id: string, fn: (c: { isInlineEditing: boolean }) => unknown) => {
            result.push(fn({ isInlineEditing: true }));
        });
        toggleInlineEditing('c1', false);
        expect((result[0] as { isInlineEditing: boolean }).isInlineEditing).toBe(false);
    });
});
