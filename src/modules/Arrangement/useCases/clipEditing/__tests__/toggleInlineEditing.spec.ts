import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleInlineEditing } from '#/modules/Arrangement/useCases/clipEditing/toggleInlineEditing';
import { updateClip } from '#/modules/Arrangement/useCases/updateClip';

vi.mock('#/modules/Arrangement/useCases/updateClip', () => ({
    updateClip: vi.fn(),
}));

describe('toggleInlineEditing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should flip isInlineEditing flag', () => {
        toggleInlineEditing('c1');
        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        expect(updater({ id: 'c1', isInlineEditing: false }).isInlineEditing).toBe(true);
        expect(updater({ id: 'c1', isInlineEditing: true }).isInlineEditing).toBe(false);
    });

    it('should respect force parameter', () => {
        toggleInlineEditing('c1', true);
        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        expect(updater({ id: 'c1', isInlineEditing: false }).isInlineEditing).toBe(true);
        expect(updater({ id: 'c1', isInlineEditing: true }).isInlineEditing).toBe(true);
    });
});
