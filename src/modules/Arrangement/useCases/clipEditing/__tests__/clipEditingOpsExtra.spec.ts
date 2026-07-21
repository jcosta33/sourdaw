import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn<(typeof updateClipUseCase)['updateClip']>(),
}));

vi.mock('../../updateClip', () => ({ updateClip: mocks.updateClip }));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { type Clip } from '../../../models/Track';
import { resetOverride } from '../resetOverride';
import { slipClipContent } from '../slipClipContent';
import { toggleInlineEditing } from '../toggleInlineEditing';

import type * as updateClipUseCase from '../../updateClip';

/** Route the mocked use case through the given clip and collect updater results. */
function captureUpdate(clip: Clip): Clip[] {
    const result: Clip[] = [];
    mocks.updateClip.mockImplementation((_clipId, updater) => {
        result.push(updater(clip));
        return true;
    });
    return result;
}

describe('resetOverride', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes the property from overrides and keeps the rest', () => {
        const result = captureUpdate(ClipDummy.create({ overrides: { gain: true, color: true } }));
        resetOverride('c1', 'gain');
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        expect(result[0]?.overrides).toEqual({ color: true });
    });

    it('leaves overrides empty when the last override is reset', () => {
        const result = captureUpdate(ClipDummy.create({ overrides: { gain: true } }));
        resetOverride('c1', 'gain');
        expect(result[0]?.overrides).toEqual({});
    });
});

describe('slipClipContent', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sets audioOffsetBeats for audio clips and leaves the midi offset alone', () => {
        const result = captureUpdate(ClipDummy.create({ audioOffsetBeats: 0, midiOffsetBeats: 0 }));
        slipClipContent('c1', 'audio', 2.5);
        expect(result[0]).toMatchObject({ audioOffsetBeats: 2.5, midiOffsetBeats: 0 });
    });

    it('sets midiOffsetBeats for midi clips and leaves the audio offset alone', () => {
        const result = captureUpdate(ClipDummy.create({ audioOffsetBeats: 0, midiOffsetBeats: 0 }));
        slipClipContent('c1', 'midi', -1);
        expect(result[0]).toMatchObject({ audioOffsetBeats: 0, midiOffsetBeats: -1 });
    });
});

describe('toggleInlineEditing', () => {
    beforeEach(() => vi.clearAllMocks());

    it('toggles from false to true', () => {
        const result = captureUpdate(ClipDummy.create({ isInlineEditing: false }));
        toggleInlineEditing('c1');
        expect(result[0]?.isInlineEditing).toBe(true);
    });

    it('toggles from true to false', () => {
        const result = captureUpdate(ClipDummy.create({ isInlineEditing: true }));
        toggleInlineEditing('c1');
        expect(result[0]?.isInlineEditing).toBe(false);
    });

    it('forces to true when specified', () => {
        const result = captureUpdate(ClipDummy.create({ isInlineEditing: false }));
        toggleInlineEditing('c1', true);
        expect(result[0]?.isInlineEditing).toBe(true);
    });

    it('forces to false when specified', () => {
        const result = captureUpdate(ClipDummy.create({ isInlineEditing: true }));
        toggleInlineEditing('c1', false);
        expect(result[0]?.isInlineEditing).toBe(false);
    });
});
