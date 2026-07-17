import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleInlineEditing } from '#/modules/Arrangement/useCases/clipEditing/toggleInlineEditing';
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

describe('toggleInlineEditing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should flip isInlineEditing flag', () => {
        toggleInlineEditing('c1');
        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        expect(updater(makeClip({ id: 'c1', isInlineEditing: false })).isInlineEditing).toBe(true);
        expect(updater(makeClip({ id: 'c1', isInlineEditing: true })).isInlineEditing).toBe(false);
    });

    it('should respect force parameter', () => {
        toggleInlineEditing('c1', true);
        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        expect(updater(makeClip({ id: 'c1', isInlineEditing: false })).isInlineEditing).toBe(true);
        expect(updater(makeClip({ id: 'c1', isInlineEditing: true })).isInlineEditing).toBe(true);
    });
});
