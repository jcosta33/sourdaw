import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resetOverride } from '#/modules/Arrangement/useCases/clipEditing/resetOverride';
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

describe('resetOverride', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should remove property from overrides map', () => {
        resetOverride('c1', 'color');
        expect(vi.mocked(updateClip)).toHaveBeenCalledWith('c1', expect.any(Function));

        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        const result = updater(makeClip({ id: 'c1', overrides: { color: true, gain: true } }));
        expect(result.overrides).toEqual({ gain: true });
        expect(result.overrides?.color).toBeUndefined();
    });
});
