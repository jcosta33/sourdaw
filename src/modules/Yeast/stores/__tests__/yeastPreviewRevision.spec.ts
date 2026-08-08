import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    publishAppliedYeastPreviewRevision,
    publishPendingYeastPreviewRevision,
    subscribeYeastPreviewRevision,
} from '../yeastPreviewRevision';

describe('yeastPreviewRevision', () => {
    afterEach(() => {
        // No public reset — module state persists. Tests use unique subscribers.
    });

    describe('publishPendingYeastPreviewRevision', () => {
        it('returns a monotonically increasing revision number', () => {
            const r1 = publishPendingYeastPreviewRevision({
                processorId: 'p1',
                parameterName: 'gain',
                transient: false,
            });
            const r2 = publishPendingYeastPreviewRevision({
                processorId: 'p1',
                parameterName: 'gain',
                transient: false,
            });

            expect(r2).toBe(r1 + 1);
            expect(r1).toBeGreaterThan(0);
        });

        it('notifies subscribers with phase "pending" and the assigned revision', () => {
            const handler = vi.fn();
            const unsub = subscribeYeastPreviewRevision(handler);

            const rev = publishPendingYeastPreviewRevision({
                processorId: 'p2',
                parameterName: 'mix',
                transient: true,
            });

            expect(handler).toHaveBeenCalledTimes(1);
            const payload = handler.mock.calls[0]?.[0];
            expect(payload.phase).toBe('pending');
            expect(payload.revision).toBe(rev);
            expect(payload.processorId).toBe('p2');
            expect(payload.parameterName).toBe('mix');
            expect(payload.transient).toBe(true);
            unsub();
        });
    });

    describe('publishAppliedYeastPreviewRevision', () => {
        it('notifies subscribers with phase "applied" and the same revision', () => {
            const handler = vi.fn();
            const unsub = subscribeYeastPreviewRevision(handler);

            const rev = publishPendingYeastPreviewRevision({
                processorId: 'p3',
                parameterName: 'feedback',
                transient: false,
            });
            handler.mockClear();

            publishAppliedYeastPreviewRevision({
                processorId: 'p3',
                parameterName: 'feedback',
                transient: false,
                revision: rev,
            });

            expect(handler).toHaveBeenCalledTimes(1);
            const payload = handler.mock.calls[0]?.[0];
            expect(payload.phase).toBe('applied');
            expect(payload.revision).toBe(rev);
            unsub();
        });
    });

    describe('subscribeYeastPreviewRevision', () => {
        it('unsubscribe stops further notifications', () => {
            const handler = vi.fn();
            const unsub = subscribeYeastPreviewRevision(handler);

            publishPendingYeastPreviewRevision({
                processorId: 'p4',
                parameterName: 'x',
                transient: false,
            });
            expect(handler).toHaveBeenCalledTimes(1);

            unsub();

            publishPendingYeastPreviewRevision({
                processorId: 'p4',
                parameterName: 'x',
                transient: false,
            });
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('multiple subscribers each receive notifications', () => {
            const h1 = vi.fn();
            const h2 = vi.fn();
            const u1 = subscribeYeastPreviewRevision(h1);
            const u2 = subscribeYeastPreviewRevision(h2);

            publishPendingYeastPreviewRevision({
                processorId: 'p5',
                parameterName: 'y',
                transient: true,
            });

            expect(h1).toHaveBeenCalledTimes(1);
            expect(h2).toHaveBeenCalledTimes(1);
            u1();
            u2();
        });
    });
});
