import { describe, it, expect, vi, beforeEach } from 'vitest';

import { slipClipContent } from '#/modules/Arrangement/useCases/clipEditing/slipClipContent';
import { updateClip } from '#/modules/Arrangement/useCases/updateClip';

import type { Clip } from '#/modules/Arrangement/models/Track';

vi.mock('#/modules/Arrangement/useCases/updateClip', () => ({
    updateClip: vi.fn(),
}));

function makeClip(overrides: Partial<Clip> & Pick<Clip, 'id'>): Clip {
    return {
        trackId: 't1',
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('slipClipContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should update audioOffsetBeats for audio clips', () => {
        slipClipContent('c1', 'audio', 2.5);
        expect(vi.mocked(updateClip)).toHaveBeenCalledWith('c1', expect.any(Function));

        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        const result = updater(makeClip({ id: 'c1', audioOffsetBeats: 0 }));
        expect(result.audioOffsetBeats).toBe(2.5);
    });

    it('should update midiOffsetBeats for midi clips', () => {
        slipClipContent('c1', 'midi', 1.0);
        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        const result = updater(makeClip({ id: 'c1', midiOffsetBeats: 0 }));
        expect(result.midiOffsetBeats).toBe(1.0);
    });

    it('reports whether the write landed', () => {
        vi.mocked(updateClip).mockReturnValueOnce(true);
        expect(slipClipContent('c1', 'audio', 2.5)).toBe(true);

        vi.mocked(updateClip).mockReturnValueOnce(false);
        expect(slipClipContent('c1', 'audio', 2.5)).toBe(false);
    });
});
