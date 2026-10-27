import { describe, expect, it, vi } from 'vitest';

import { createAudioPreviewIntents } from '../createAudioPreviewIntents';

type PreviewIntents = ReturnType<typeof createAudioPreviewIntents>;
type PreviewIntent = ReturnType<PreviewIntents['beginOrdinary']>;

function deferred() {
    let complete: () => void = () => {
        throw new Error('The deferred work must be initialized.');
    };
    const promise = new Promise<void>((resolve) => {
        complete = resolve;
    });
    return { promise, complete };
}

describe('audio preview intent ownership', () => {
    it('keeps ordinary preview and note intents independent', () => {
        const owner = createAudioPreviewIntents();
        const first = owner.beginOrdinary();
        const second = owner.beginOrdinary();
        expect(first.isCurrent()).toBe(true);
        expect(second.isCurrent()).toBe(true);
        first.release();
        expect(first.isCurrent()).toBe(false);
        expect(second.isCurrent()).toBe(true);
    });

    it('invalidates every existing ordinary intent synchronously for an exclusive audition', () => {
        const owner = createAudioPreviewIntents();
        const pendingDecode = owner.beginOrdinary();
        const pendingNote = owner.beginOrdinary();
        const cancelDecode = vi.fn();
        const cancelNote = vi.fn();
        pendingDecode.signal.addEventListener('abort', cancelDecode);
        pendingNote.signal.addEventListener('abort', cancelNote);
        const exclusive = owner.beginExclusive();
        expect(pendingDecode.isCurrent()).toBe(false);
        expect(pendingNote.isCurrent()).toBe(false);
        expect(pendingDecode.signal.reason).toBe('preempted');
        expect(cancelDecode).toHaveBeenCalledTimes(1);
        expect(cancelNote).toHaveBeenCalledTimes(1);
        expect(exclusive.isCurrent()).toBe(true);
    });

    it('lets a new ordinary intent preempt the exclusive audition without preempting other ordinary intents', () => {
        const owner = createAudioPreviewIntents();
        const exclusive = owner.beginExclusive();
        const endExclusive = vi.fn();
        exclusive.signal.addEventListener('abort', endExclusive);
        const first = owner.beginOrdinary();
        const second = owner.beginOrdinary();
        expect(exclusive.isCurrent()).toBe(false);
        expect(exclusive.signal.reason).toBe('preempted');
        expect(endExclusive).toHaveBeenCalledTimes(1);
        expect(first.isCurrent()).toBe(true);
        expect(second.isCurrent()).toBe(true);
    });

    it.each(['beginOrdinary', 'beginExclusive'] as const)(
        'does not let an old %s release clear a successor exclusive intent',
        (begin) => {
            const owner = createAudioPreviewIntents();
            const old = owner[begin]();
            const current = owner.beginExclusive();
            old.release();
            old.release();
            expect(old.isCurrent()).toBe(false);
            expect(old.signal.reason).toBe('preempted');
            expect(current.isCurrent()).toBe(true);
            const ordinary = owner.beginOrdinary();
            expect(current.isCurrent()).toBe(false);
            expect(ordinary.isCurrent()).toBe(true);
        }
    );

    it('notifies release only once even when its callback releases it again', () => {
        const owner = createAudioPreviewIntents();
        const lease = owner.beginExclusive();
        const ended = vi.fn(() => lease.release());
        lease.signal.addEventListener('abort', ended);
        lease.release();
        lease.release();
        expect(ended).toHaveBeenCalledTimes(1);
        expect(lease.signal.reason).toBe('released');
    });

    it.each(['beginOrdinary', 'beginExclusive'] as const)(
        'cancels every outgoing %s intent during disposal',
        (begin) => {
            const owner = createAudioPreviewIntents();
            const lease = owner[begin]();
            const ended = vi.fn();
            lease.signal.addEventListener('abort', ended);
            owner.dispose();
            owner.dispose();
            lease.release();
            expect(lease.isCurrent()).toBe(false);
            expect(lease.signal.reason).toBe('disposed');
            expect(ended).toHaveBeenCalledTimes(1);
        }
    );

    it('disposes all ordinary intents, not just the newest', () => {
        const owner = createAudioPreviewIntents();
        const intents = [owner.beginOrdinary(), owner.beginOrdinary(), owner.beginOrdinary()];
        owner.dispose();
        expect(intents.map((lease) => lease.signal.reason)).toEqual(['disposed', 'disposed', 'disposed']);
    });

    it.each(['beginOrdinary', 'beginExclusive'] as const)(
        'refuses %s on a disposed owner without affecting a fresh engine lifetime',
        (begin) => {
            const outgoing = createAudioPreviewIntents();
            outgoing.dispose();
            const fresh = createAudioPreviewIntents();
            const current = fresh.beginExclusive();
            const stale = outgoing[begin]();
            stale.release();
            expect(stale.isCurrent()).toBe(false);
            expect(stale.signal.reason).toBe('disposed');
            expect(current.isCurrent()).toBe(true);
        }
    );

    it('keeps a newer reentrant exclusive gesture when an old cancellation callback starts it', () => {
        const owner = createAudioPreviewIntents();
        const old = owner.beginExclusive();
        let newest: PreviewIntent | undefined;
        old.signal.addEventListener('abort', () => {
            newest = owner.beginExclusive();
        });
        const displaced = owner.beginExclusive();
        expect(old.isCurrent()).toBe(false);
        expect(displaced.isCurrent()).toBe(false);
        expect(newest?.isCurrent()).toBe(true);
        displaced.release();
        expect(newest?.isCurrent()).toBe(true);
        owner.beginOrdinary();
        expect(newest?.isCurrent()).toBe(false);
    });

    it('keeps a newer ordinary gesture from cancellation instead of allowing the outer audition to revive', () => {
        const owner = createAudioPreviewIntents();
        const old = owner.beginOrdinary();
        let newest: PreviewIntent | undefined;
        old.signal.addEventListener('abort', () => {
            newest = owner.beginOrdinary();
        });
        const displaced = owner.beginExclusive();
        expect(displaced.isCurrent()).toBe(false);
        expect(newest?.isCurrent()).toBe(true);
        old.release();
        expect(newest?.isCurrent()).toBe(true);
    });

    it('preserves a newer exclusive gesture even when an old ordinary callback then releases its old lease', () => {
        const owner = createAudioPreviewIntents();
        const old = owner.beginOrdinary();
        let newest: PreviewIntent | undefined;
        old.signal.addEventListener('abort', () => {
            newest = owner.beginExclusive();
            old.release();
        });
        const displaced = owner.beginExclusive();
        expect(displaced.isCurrent()).toBe(false);
        expect(newest?.isCurrent()).toBe(true);
    });

    it('refuses reentrant work during disposal before notifying outgoing listeners', () => {
        const owner = createAudioPreviewIntents();
        const old = owner.beginExclusive();
        let attempted: PreviewIntent | undefined;
        old.signal.addEventListener('abort', () => {
            attempted = owner.beginOrdinary();
        });
        owner.dispose();
        expect(attempted?.isCurrent()).toBe(false);
        expect(attempted?.signal.reason).toBe('disposed');
    });

    it('does not revive invalidated intent when previously started asynchronous preparation completes', async () => {
        const owner = createAudioPreviewIntents();
        const staleDecode = owner.beginOrdinary();
        const preparation = deferred();
        const settled = preparation.promise.then(() => staleDecode.isCurrent());
        const current = owner.beginExclusive();
        expect(staleDecode.signal.aborted).toBe(true);
        preparation.complete();
        await expect(settled).resolves.toBe(false);
        expect(current.isCurrent()).toBe(true);
    });
});
