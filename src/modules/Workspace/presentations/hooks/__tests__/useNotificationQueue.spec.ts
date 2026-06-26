import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { onNotification } from '../../../useCases/onNotification';
import { useNotificationQueue } from '../useNotificationQueue';

vi.mock('../../../useCases/onNotification', () => ({
    onNotification: vi.fn(),
}));

type NotifyPayload = { message: string; level: 'warning' | 'error' | 'info' | 'success' };

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
