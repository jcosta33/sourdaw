import { describe, it, expect, vi } from 'vitest';

import { executeDsoEdit, parseEditPlan } from '../executeDsoEdit';

vi.mock('../../llmOrchestration/backendResolution/isDsoBackendAvailable', () => ({
    isDsoBackendAvailable: () => false,
}));

vi.mock('../../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'none' as const,
}));

describe('executeDsoEdit', () => {
    it('should return failure when no DSO-capable backend is available', async () => {
        const result = await executeDsoEdit('make it louder');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/DSO-capable backend/);
        expect(result.plan).toBeNull();
    });
});

describe('parseEditPlan', () => {
    it('parses a well-formed EditPlan directly', () => {
        const plan = parseEditPlan(
            JSON.stringify({
                kind: 'edit_plan',
                moderation: 'allow',
                intent: 'mute drums',
                dsos: [{ op: 'mute_track', track_id: 't1', muted: true }],
            })
        );
        expect(plan.intent).toBe('mute drums');
        expect(plan.dsos).toHaveLength(1);
    });

    it('salvages an EditPlan embedded in prose', () => {
        const raw = `Sure! Here is the plan:\n{"kind":"edit_plan","moderation":"allow","intent":"x","dsos":[]}\nDone.`;
        const plan = parseEditPlan(raw);
        expect(plan.kind).toBe('edit_plan');
        expect(plan.dsos).toEqual([]);
    });

    it('honors braces inside string literals when scanning', () => {
        const raw = `noise {"kind":"edit_plan","moderation":"allow","intent":"name } with brace","dsos":[]} trailing`;
        const plan = parseEditPlan(raw);
        expect(plan.intent).toBe('name } with brace');
    });

    // Fix 2: an object that parses as JSON but is not a valid EditPlan must be
    // rejected — not returned as an EditPlan via an unchecked cast.
    it('rejects a parseable object with an invalid moderation value', () => {
        const raw = JSON.stringify({ kind: 'edit_plan', moderation: 'maybe', intent: 'x', dsos: [] });
        expect(() => parseEditPlan(raw)).toThrow(/moderation/);
    });

    it('rejects a plan whose dsos contain an unknown op', () => {
        const raw = JSON.stringify({
            kind: 'edit_plan',
            moderation: 'allow',
            intent: 'x',
            dsos: [{ op: 'drop_database' }],
        });
        expect(() => parseEditPlan(raw)).toThrow(/unknown "op"/);
    });

    it('rejects a plan whose intent is missing', () => {
        const raw = JSON.stringify({ kind: 'edit_plan', moderation: 'allow', dsos: [] });
        expect(() => parseEditPlan(raw)).toThrow(/intent/);
    });

    it('rejects a dso entry that is not an object', () => {
        const raw = JSON.stringify({ kind: 'edit_plan', moderation: 'allow', intent: 'x', dsos: ['nope'] });
        expect(() => parseEditPlan(raw)).toThrow(/dsos\[0\]/);
    });

    // Fix 1: malformed input that would trigger catastrophic backtracking on the
    // old greedy regex must complete near-instantly with the linear scanner.
    it('does not catastrophically backtrack on adversarial unbalanced input', () => {
        // An opening brace + the trigger token + a very long run with no balanced
        // close. The old /\{[\s\S]*"kind":"edit_plan"[\s\S]*\}/ would backtrack;
        // the brace-balanced scanner walks it once and bails.
        const adversarial = `{${'"kind":"edit_plan",'.repeat(4000)}${'['.repeat(4000)}`;
        const start = performance.now();
        expect(() => parseEditPlan(adversarial)).toThrow();
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(500);
    });

    it('caps the salvage scan at the size limit (oversized input still returns fast)', () => {
        // 5 MB of garbage with a trigger token far past the 16 kB cap.
        const huge = `${'x'.repeat(5_000_000)}{"kind":"edit_plan","moderation":"allow","intent":"x","dsos":[]}`;
        const start = performance.now();
        expect(() => parseEditPlan(huge)).toThrow(/not a valid EditPlan/);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(500);
    });
});
