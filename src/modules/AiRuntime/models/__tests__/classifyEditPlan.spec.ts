import { describe, it, expect } from 'vitest';

import { type EditPlan } from '../DsoTypes';
import { classifyEditPlan } from '../DsoTypes';

function plan(overrides: Partial<EditPlan> = {}): EditPlan {
    return {
        kind: 'edit_plan',
        moderation: 'allow',
        intent: 'do something',
        dsos: [],
        ...overrides,
    };
}

describe('classifyEditPlan', () => {
    it('returns auto_apply for a safe plan with no destructive ops', () => {
        const result = classifyEditPlan(plan({ dsos: [{ op: 'add_track', name: 'Synth', kind: 'midi' }] }));
        expect(result).toBe('auto_apply');
    });

    it('returns confirmation_required when moderation is "block"', () => {
        const result = classifyEditPlan(plan({ moderation: 'block' }));
        expect(result).toBe('confirmation_required');
    });

    it('returns confirmation_required when a DSO is remove_track', () => {
        const result = classifyEditPlan(plan({ dsos: [{ op: 'remove_track', track_id: 't1' }] }));
        expect(result).toBe('confirmation_required');
    });

    it('returns confirmation_required when a DSO is remove_clip', () => {
        const result = classifyEditPlan(plan({ dsos: [{ op: 'remove_clip', clip_id: 'c1' }] }));
        expect(result).toBe('confirmation_required');
    });

    it('returns confirmation_required when a DSO is remove_device', () => {
        const result = classifyEditPlan(plan({ dsos: [{ op: 'remove_device', device_id: 'd1', track_id: 't1' }] }));
        expect(result).toBe('confirmation_required');
    });

    it('returns auto_apply when moderation is "needs_confirmation" but no DSO is destructive', () => {
        // "needs_confirmation" is advisory — without destructive ops, auto_apply.
        const result = classifyEditPlan(
            plan({
                moderation: 'needs_confirmation',
                dsos: [{ op: 'set_tempo', bpm: 140 }],
            })
        );
        expect(result).toBe('auto_apply');
    });

    it('returns confirmation_required when a destructive op appears among non-destructive ones', () => {
        const result = classifyEditPlan(
            plan({
                dsos: [
                    { op: 'add_track', name: 'Drums', kind: 'audio' },
                    { op: 'remove_clip', clip_id: 'c1' },
                ],
            })
        );
        expect(result).toBe('confirmation_required');
    });

    it('returns auto_apply for an empty DSO list with allow moderation', () => {
        expect(classifyEditPlan(plan())).toBe('auto_apply');
    });

    it('prioritizes moderation block over destructive ops (both trigger confirmation)', () => {
        const result = classifyEditPlan(plan({ moderation: 'block', dsos: [{ op: 'remove_track', track_id: 't1' }] }));
        expect(result).toBe('confirmation_required');
    });
});
