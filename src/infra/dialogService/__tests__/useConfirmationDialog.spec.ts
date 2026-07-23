import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { onConfirmation } from '../onConfirmation';
import { useConfirmationDialog } from '../useConfirmationDialog';

vi.mock('../onConfirmation', () => ({
    onConfirmation: vi.fn(),
}));

type ConfirmPayload = {
    id: string;
    message: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'danger';
    resolve: (ok: boolean) => void;
};

let emit: ((payload: ConfirmPayload) => void) | null = null;

function makePayload(overrides: Partial<ConfirmPayload>): ConfirmPayload {
    return {
        id: 'confirm-1',
        message: 'Are you sure?',
        resolve: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    emit = null;
    vi.mocked(onConfirmation).mockImplementation((handler: (payload: ConfirmPayload) => void) => {
        emit = handler;
        return () => {
            emit = null;
        };
    });
});

describe('useConfirmationDialog', () => {
    it('starts with no pending confirmation', () => {
        const { result } = renderHook(() => useConfirmationDialog());

        expect(result.current.pending).toBeNull();
    });

    it('sets pending when a ui.confirm event arrives', () => {
        const { result } = renderHook(() => useConfirmationDialog());
        const payload = makePayload({ message: 'Delete this track?' });

        act(() => {
            emit!(payload);
        });

        expect(result.current.pending).toBe(payload);
    });

    it('confirm() resolves true and clears pending', () => {
        const { result } = renderHook(() => useConfirmationDialog());
        const resolve = vi.fn();

        act(() => {
            emit!(makePayload({ resolve }));
        });

        act(() => {
            result.current.confirm();
        });

        expect(resolve).toHaveBeenCalledWith(true);
        expect(result.current.pending).toBeNull();
    });

    it('cancel() resolves false and clears pending', () => {
        const { result } = renderHook(() => useConfirmationDialog());
        const resolve = vi.fn();

        act(() => {
            emit!(makePayload({ resolve }));
        });

        act(() => {
            result.current.cancel();
        });

        expect(resolve).toHaveBeenCalledWith(false);
        expect(result.current.pending).toBeNull();
    });

    it('confirm() with no pending payload does nothing and stays null', () => {
        const { result } = renderHook(() => useConfirmationDialog());

        act(() => {
            result.current.confirm();
        });

        expect(result.current.pending).toBeNull();
    });

    it('auto-resolves an overlapping pending confirmation to false when a second ui.confirm arrives', () => {
        const { result } = renderHook(() => useConfirmationDialog());
        const firstResolve = vi.fn();
        const secondResolve = vi.fn();

        act(() => {
            emit!(makePayload({ id: 'confirm-1', message: 'First', resolve: firstResolve }));
        });
        act(() => {
            emit!(makePayload({ id: 'confirm-2', message: 'Second', resolve: secondResolve }));
        });

        expect(firstResolve).toHaveBeenCalledWith(false);
        expect(secondResolve).not.toHaveBeenCalled();
        expect(result.current.pending?.message).toBe('Second');
    });

    it('unsubscribes on unmount', () => {
        const { unmount } = renderHook(() => useConfirmationDialog());

        expect(emit).not.toBeNull();
        unmount();

        expect(emit).toBeNull();
    });
});
