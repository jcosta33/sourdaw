import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { onNotification } from '../onNotification';
import { useNotificationQueue } from '../useNotificationQueue';

vi.mock('../onNotification', () => ({
    onNotification: vi.fn(),
}));

type NotifyPayload = {
    message: string;
    level: 'warning' | 'error' | 'info' | 'success';
    action?: {
        label: string;
        isValid: () => boolean;
        execute: () => boolean | void | Promise<boolean | void>;
    };
};

let emit: ((payload: NotifyPayload) => void) | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    emit = null;
    vi.mocked(onNotification).mockImplementation((handler: (p: NotifyPayload) => void) => {
        emit = handler;
        return () => {
            emit = null;
        };
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useNotificationQueue — head auto-dismiss is not starved by new arrivals (#10)', () => {
    it('dismisses the head after 8s even when later notifications keep arriving < 8s apart', () => {
        const { result } = renderHook(() => useNotificationQueue());

        // Head arrives at t=0.
        act(() => {
            emit!({ message: 'first', level: 'info' });
        });
        expect(result.current.items.map((i) => i.message)).toEqual(['first']);

        // A distinct notification arrives at t=5s (< 8s) — must NOT reset the
        // head's auto-dismiss timer.
        act(() => {
            vi.advanceTimersByTime(5000);
            emit!({ message: 'second', level: 'info' });
        });
        expect(result.current.items.map((i) => i.message)).toEqual(['first', 'second']);

        // At t=8s the head ('first') must auto-dismiss despite 'second' having
        // arrived in between. Before the fix, the [items] dependency restarted
        // the timer on each arrival and 'first' would still be present here.
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(result.current.items.map((i) => i.message)).toEqual(['second']);
    });
});

describe('useNotificationQueue — dismissCurrent clears the displayed head (#11)', () => {
    it('removes the head item (the one the toast renders), not a tail item', () => {
        const { result } = renderHook(() => useNotificationQueue());

        act(() => {
            emit!({ message: 'oldest', level: 'info' });
            emit!({ message: 'newest', level: 'info' });
        });
        expect(result.current.items.map((i) => i.message)).toEqual(['oldest', 'newest']);

        act(() => {
            result.current.dismissCurrent();
        });

        // The head ('oldest', which the toast shows as the current item) is gone.
        expect(result.current.items.map((i) => i.message)).toEqual(['newest']);
    });
});

describe('useNotificationQueue — session history', () => {
    it('retains auto-dismissed entries as unread history', () => {
        const { result } = renderHook(() => useNotificationQueue());
        act(() => {
            emit!({ message: 'first', level: 'info' });
            emit!({ message: 'second', level: 'warning' });
        });
        act(() => {
            vi.advanceTimersByTime(8000);
        });

        expect(result.current.items.map((item) => item.message)).toEqual(['second']);
        expect(result.current.history.map((item) => item.message)).toEqual(['second', 'first']);
        expect(result.current.history[1]).toMatchObject({ message: 'first', read: false });
        expect(result.current.unreadCount).toBe(2);
    });

    it('bounds history and preserves queue deduplication', () => {
        const { result } = renderHook(() => useNotificationQueue());
        act(() => {
            for (let index = 0; index < 55; index++) {
                emit!({ message: `notification-${index}`, level: 'info' });
            }
            emit!({ message: 'notification-54', level: 'info' });
        });

        expect(result.current.history).toHaveLength(50);
        expect(result.current.history[0]?.message).toBe('notification-54');
        expect(result.current.history[49]?.message).toBe('notification-5');
        expect(result.current.history.filter((item) => item.message === 'notification-54')).toHaveLength(1);
    });

    it('acknowledges toast dismissal and removes history dismissal from both surfaces', () => {
        const { result } = renderHook(() => useNotificationQueue());
        act(() => {
            emit!({ message: 'first', level: 'info' });
            emit!({ message: 'second', level: 'info' });
        });
        const firstId = result.current.history[1]!.id;

        act(() => {
            result.current.dismissCurrent();
        });
        expect(result.current.history.find((item) => item.id === firstId)).toMatchObject({ read: true });

        act(() => {
            result.current.dismissNotification(firstId);
        });
        expect(result.current.history.some((item) => item.id === firstId)).toBe(false);

        act(() => {
            result.current.markAllRead();
        });
        expect(result.current.unreadCount).toBe(0);
    });

    it('refuses an action when its original target is stale', async () => {
        const { result } = renderHook(() => useNotificationQueue());
        let target = 'original';
        const execute = vi.fn();
        act(() => {
            emit!({
                message: 'Undo available',
                level: 'info',
                action: {
                    label: 'Undo',
                    isValid: () => target === 'original',
                    execute,
                },
            });
        });
        const id = result.current.history[0]!.id;
        target = 'replacement';

        await act(async () => {
            await result.current.runAction(id);
        });

        expect(execute).not.toHaveBeenCalled();
        expect(result.current.history[0]).toMatchObject({ actionStatus: 'stale' });
    });

    it('executes a valid action and reports a producer refusal', async () => {
        const { result } = renderHook(() => useNotificationQueue());
        const execute = vi.fn().mockResolvedValue(undefined);
        const refuse = vi.fn().mockResolvedValue(false);
        act(() => {
            emit!({
                message: 'Valid action',
                level: 'info',
                action: { label: 'Retry', isValid: () => true, execute },
            });
            emit!({
                message: 'Refused action',
                level: 'warning',
                action: { label: 'Locate', isValid: () => true, execute: refuse },
            });
        });

        await act(async () => {
            await result.current.runAction(result.current.history[1]!.id);
            await result.current.runAction(result.current.history[0]!.id);
        });

        expect(execute).toHaveBeenCalledTimes(1);
        expect(refuse).toHaveBeenCalledTimes(1);
        expect(result.current.history[1]).toMatchObject({ actionStatus: 'success' });
        expect(result.current.history[0]).toMatchObject({
            actionStatus: 'refused',
            actionFeedback: 'The action was refused.',
        });
    });
});
