import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepareRestore: vi.fn() }));
vi.mock('../prepareTimeOperationStateRestore', () => ({ prepareTimeOperationStateRestore: mocks.prepareRestore }));

import { createUndoableGlobalTimeOperation } from '../createUndoableGlobalTimeOperation';
import { timeOperationStateCodec } from '../timeOperationStateCodec';

function createInitialResult(automation: unknown) {
    return {
        status: 'applied' as const,
        hasChanges: true as const,
        replayPlan: {
            version: 1 as const,
            operation: { type: 'insert' as const, atBeat: 0, durationBeats: 4 },
            clips: [],
            midi: { version: 1 as const, notes: [] },
        },
        inversePlan: {
            version: 1,
            scope: 'global',
            local: { version: 1, expected: 'after', replacement: 'before' },
            automation,
            midi: null,
            timelineMap: null,
            clipSatellites: null,
        },
    };
}

function lastRestorePlan(): Record<string, unknown> {
    const plan: unknown = mocks.prepareRestore.mock.lastCall?.[0];
    if (plan === null || typeof plan !== 'object') {
        throw new Error('Expected a restore plan');
    }
    return plan as Record<string, unknown>;
}

describe('createUndoableGlobalTimeOperation', () => {
    it('reverses an owner plan the codec had to encode opaquely', () => {
        // An owner plan holding an own key whose value is `undefined` does not
        // survive the canonical JSON round trip, so the operation stores the
        // codec's opaque node for it rather than a plain record. Spreading that
        // node swaps two keys it does not have, which used to hand redo a plan
        // with `expected: undefined` that every later validation rejects.
        const ownerPlan = { version: 1, expected: { beat: undefined }, replacement: { beat: 4 } };
        expect(timeOperationStateCodec.cloneJsonPlan(ownerPlan)).toBeNull();
        const opaque = timeOperationStateCodec.encodeOpaqueJsonPlan(ownerPlan);
        expect(opaque).not.toBeNull();
        mocks.prepareRestore.mockReturnValue({ status: 'ready', hasChanges: true, apply: () => true });

        const transaction = createUndoableGlobalTimeOperation({ initialResult: createInitialResult(opaque) });
        transaction.redo();

        const redoPlan = lastRestorePlan();
        const decoded = timeOperationStateCodec.decodeOpaqueJsonPlan(redoPlan.automation);
        expect(decoded).not.toBeNull();
        if (!decoded) {
            throw new Error('Expected the reversed owner slot to decode');
        }
        expect(decoded.version).toBe(1);
        expect(decoded.expected).toEqual({ beat: 4 });
        const replacement = decoded.replacement as { beat: unknown };
        expect(Object.hasOwn(replacement, 'beat')).toBe(true);
        expect(replacement.beat).toBeUndefined();
    });

    it('reverses a plain owner plan by swapping its two sides', () => {
        const ownerPlan = { version: 1, expected: { beat: 8 }, replacement: { beat: 4 } };
        mocks.prepareRestore.mockReturnValue({ status: 'ready', hasChanges: true, apply: () => true });

        const transaction = createUndoableGlobalTimeOperation({ initialResult: createInitialResult(ownerPlan) });
        transaction.redo();

        expect(lastRestorePlan().automation).toEqual({
            version: 1,
            expected: { beat: 4 },
            replacement: { beat: 8 },
        });
    });

    it('refuses an owner slot that is neither a plan nor an encoded one', () => {
        mocks.prepareRestore.mockReturnValue({ status: 'ready', hasChanges: true, apply: () => true });

        expect(() =>
            createUndoableGlobalTimeOperation({ initialResult: createInitialResult({ nonsense: true }) })
        ).toThrow(TypeError);
    });
});
