import { describe, expect, it } from 'vitest';

import { createExpectedValueHandler } from '../createExpectedValueHandler';
import { type HandlerValidationContext } from '../handlerContract';

const context: HandlerValidationContext = { actions: [], actionIndex: 0 };

type Rename = { type: 'renameClip'; payload: { clipId: string; name: string; expectedName?: string } };

function createFixture(initial: Record<string, string>) {
    const names = new Map(Object.entries(initial));
    const planned = new Map<string, string>();
    const writes: string[] = [];
    const handler = createExpectedValueHandler<'renameClip', string>({
        label: (action) => `Rename to ${action.payload.name}`,
        requested: (action) => action.payload.name,
        expected: (action) => action.payload.expectedName,
        read: (action, readContext) => {
            if (readContext && planned.has(action.payload.clipId)) {
                return planned.get(action.payload.clipId);
            }
            return names.get(action.payload.clipId);
        },
        withExpected: (action, name, expectedName) => ({
            type: 'renameClip',
            payload: { clipId: action.payload.clipId, name, expectedName },
        }),
        refuse: (action) => (action.payload.name === 'refused' ? { status: 'no-write' } : null),
        write: (action) => {
            writes.push(action.payload.name);
            names.set(action.payload.clipId, action.payload.name);
            return { status: 'written' };
        },
    });
    return { handler, names, planned, writes };
}

const rename = (name: string, expectedName?: string): Rename => ({
    type: 'renameClip',
    payload: { clipId: 'a', name, expectedName },
});

describe('createExpectedValueHandler', () => {
    it('stamps the written value on the inverse and the replaced value on the redo', () => {
        const { handler } = createFixture({ a: 'old' });

        const description = handler.describe(rename('new'), context);

        expect(description.label).toBe('Rename to new');
        expect(description.inverseAction).toEqual(rename('old', 'new'));
        expect(description.redoAction).toEqual(rename('new', 'old'));
    });

    it('describes through the planned value when a context is given', () => {
        const { handler, planned } = createFixture({ a: 'old' });
        planned.set('a', 'earlier-in-batch');

        expect(handler.describe(rename('new'), context).inverseAction).toEqual(rename('earlier-in-batch', 'new'));
        expect(handler.describe(rename('new')).inverseAction).toEqual(rename('old', 'new'));
    });

    it('records no inverse for an absent target', () => {
        const { handler } = createFixture({});

        expect(handler.describe(rename('new'), context).inverseAction).toBeNull();
    });

    it('answers the divergence question on the presence of the guard only', () => {
        const { handler } = createFixture({ a: 'old' });

        expect(handler.canReapplyAfterDivergence?.(rename('x'))).toBe(false);
        expect(handler.canReapplyAfterDivergence?.(rename('x', 'old'))).toBe(true);
    });

    it('validates a guard against the planned value and admits an unguarded action', () => {
        const { handler, planned } = createFixture({ a: 'old' });
        planned.set('a', 'planned');

        expect(handler.validate?.(rename('x'), context)).toBe(true);
        expect(handler.validate?.(rename('x', 'planned'), context)).toBe(true);
        expect(handler.validate?.(rename('x', 'old'), context)).toBe(false);
    });

    it('refuses a guard against an absent target', () => {
        const { handler } = createFixture({});

        expect(handler.validate?.(rename('x', 'old'), context)).toBe(false);
    });

    it('writes when the live value matches the guard and reports a conflict without writing otherwise', () => {
        const { handler, names, writes } = createFixture({ a: 'old' });

        expect(handler.execute(rename('mid', 'old'))).toEqual({ status: 'written' });
        expect(handler.execute(rename('late', 'old'))).toEqual({ status: 'conflict' });
        expect(names.get('a')).toBe('mid');
        expect(writes).toEqual(['mid']);
    });

    it('lets a refusal end the action before the guard', () => {
        const { handler, writes } = createFixture({ a: 'old' });

        expect(handler.execute(rename('refused', 'something-else'))).toEqual({ status: 'no-write' });
        expect(writes).toEqual([]);
    });

    it('is a no-op exactly when the target already holds the requested value, whatever the guard expects', () => {
        const { handler } = createFixture({ a: 'same' });

        expect(handler.isNoop?.(rename('same'))).toBe(true);
        expect(handler.isNoop?.(rename('same', 'same'))).toBe(true);
        expect(handler.isNoop?.(rename('same', 'other'))).toBe(true);
        expect(handler.isNoop?.(rename('different', 'same'))).toBe(false);
        expect(handler.isNoop?.(rename('different'))).toBe(false);
        expect(createFixture({}).handler.isNoop?.(rename('same'))).toBe(false);
    });

    it('compares structured values through the supplied equality', () => {
        const store = { value: { a: 1, b: 2 } };
        const handler = createExpectedValueHandler<'setClipFade', { a: number; b: number }>({
            label: () => 'Fade',
            requested: (action) => ({ a: action.payload.fadeInBeats, b: action.payload.fadeOutBeats }),
            expected: (action) => {
                const { expectedFadeInBeats: a, expectedFadeOutBeats: b } = action.payload;
                if (a === undefined || b === undefined) {
                    return undefined;
                }
                return { a, b };
            },
            read: () => store.value,
            matches: (current, expected) => current.a === expected.a && current.b === expected.b,
            sameValue: (left, right) => left.a === right.a && left.b === right.b,
            withExpected: (action, value, expected) => ({
                type: 'setClipFade',
                payload: {
                    clipId: action.payload.clipId,
                    fadeInBeats: value.a,
                    fadeOutBeats: value.b,
                    expectedFadeInBeats: expected.a,
                    expectedFadeOutBeats: expected.b,
                },
            }),
            write: () => ({ status: 'written' }),
        });
        const fade = (a: number, b: number, expected?: [number, number]) => ({
            type: 'setClipFade' as const,
            payload: {
                clipId: 'c',
                fadeInBeats: a,
                fadeOutBeats: b,
                expectedFadeInBeats: expected?.[0],
                expectedFadeOutBeats: expected?.[1],
            },
        });

        expect(handler.execute(fade(3, 4, [1, 2]))).toEqual({ status: 'written' });
        expect(handler.execute(fade(3, 4, [1, 9]))).toEqual({ status: 'conflict' });
        expect(handler.isNoop?.(fade(1, 2))).toBe(true);
        expect(handler.isNoop?.(fade(1, 3))).toBe(false);
    });
});
