import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slipClipContent } from '#/modules/Arrangement/useCases/clipEditing/slipClipContent';
import { updateClip } from '#/modules/Arrangement/useCases/updateClip';

vi.mock('#/modules/Arrangement/useCases/updateClip', () => ({
    updateClip: vi.fn(),
}));

describe('slipClipContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should update audioOffsetBeats for audio clips', () => {
        slipClipContent('c1', 'audio', 2.5);
        expect(vi.mocked(updateClip)).toHaveBeenCalledWith('c1', expect.any(Function));
        
        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        const result = updater({ id: 'c1', audioOffsetBeats: 0 });
        expect(result.audioOffsetBeats).toBe(2.5);
    });

    it('should update midiOffsetBeats for midi clips', () => {
        slipClipContent('c1', 'midi', 1.0);
        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        const result = updater({ id: 'c1', midiOffsetBeats: 0 });
        expect(result.midiOffsetBeats).toBe(1.0);
    });
});
