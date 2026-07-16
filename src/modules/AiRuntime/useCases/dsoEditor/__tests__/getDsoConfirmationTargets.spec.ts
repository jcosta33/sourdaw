import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        value: {
            tracks: [
                {
                    id: 't1',
                    name: 'Drums',
                    clips: [{ id: 'c1', name: 'Beat', trackId: 't1' }],
                    devices: [{ id: 'd1', name: 'Gluten' }],
                },
                { id: 't2', name: 'Bass', clips: [], devices: [] },
            ],
        },
        set: vi.fn(),
    },
}));

import { getDsoConfirmationTargets } from '../getDsoConfirmationTargets';

describe('getDsoConfirmationTargets', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns empty for empty DSO list', () => {
        const result = getDsoConfirmationTargets({ dsos: [] });
        expect(result.actionLabels).toEqual([]);
        expect(result.confirmationTargets).toEqual([]);
    });

    it('handles remove_track DSO', () => {
        const result = getDsoConfirmationTargets({ dsos: [{ op: 'remove_track', track_id: 't1' }] as never });
        expect(result.actionLabels).toHaveLength(1);
        expect(result.confirmationTargets).toHaveLength(1);
    });

    it('handles remove_clip DSO', () => {
        const result = getDsoConfirmationTargets({ dsos: [{ op: 'remove_clip', clip_id: 'c1' }] as never });
        expect(result.actionLabels).toHaveLength(1);
        expect(result.confirmationTargets).toHaveLength(1);
    });

    it('handles unknown track gracefully', () => {
        const result = getDsoConfirmationTargets({ dsos: [{ op: 'remove_track', track_id: 'nonexistent' }] as never });
        expect(result.actionLabels).toHaveLength(1);
    });

    it('handles multiple DSOs', () => {
        const result = getDsoConfirmationTargets({
            dsos: [
                { op: 'remove_track', track_id: 't1' },
                { op: 'remove_clip', clip_id: 'c1' },
            ] as never,
        });
        expect(result.actionLabels).toHaveLength(2);
        expect(result.confirmationTargets).toHaveLength(2);
    });
});
