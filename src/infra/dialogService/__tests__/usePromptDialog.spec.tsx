import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockOnPromptReturn = vi.fn();

vi.mock('../onPrompt', () => ({
    onPrompt: (handler: (payload: unknown) => void) => {
        mockOnPromptReturn.mockImplementation(handler);
        return () => {};
    },
}));

import { usePromptDialog } from '../usePromptDialog';

describe('usePromptDialog', () => {
    it('starts with no pending prompt and an empty value', () => {
        const { result } = renderHook(() => usePromptDialog());

        expect(result.current.pending).toBeNull();
        expect(result.current.value).toBe('');
    });

    it('sets pending payload and initializes value from initialValue when a prompt arrives', () => {
        const { result } = renderHook(() => usePromptDialog());

        const resolve = vi.fn();
        act(() => {
            mockOnPromptReturn({ id: 'p1', message: 'Enter name', initialValue: 'hello', resolve });
        });

        expect(result.current.pending).toEqual({ id: 'p1', message: 'Enter name', initialValue: 'hello', resolve });
        expect(result.current.value).toBe('hello');
    });

    it('initializes value to empty string when initialValue is absent', () => {
        const { result } = renderHook(() => usePromptDialog());

        act(() => {
            mockOnPromptReturn({ id: 'p2', message: 'Enter', resolve: vi.fn() });
        });

        expect(result.current.value).toBe('');
    });

    it('submit resolves with the trimmed value and clears pending', () => {
        const { result } = renderHook(() => usePromptDialog());
        const resolve = vi.fn();

        act(() => {
            mockOnPromptReturn({ id: 'p3', message: 'Enter', resolve });
        });
        act(() => {
            result.current.setValue('  trimmed  ');
        });
        act(() => {
            result.current.submit();
        });

        expect(resolve).toHaveBeenCalledWith('trimmed');
        expect(result.current.pending).toBeNull();
        expect(result.current.value).toBe('');
    });

    it('submit resolves with null when the trimmed value is empty', () => {
        const { result } = renderHook(() => usePromptDialog());
        const resolve = vi.fn();

        act(() => {
            mockOnPromptReturn({ id: 'p4', message: 'Enter', resolve });
        });
        act(() => {
            result.current.setValue('   ');
        });
        act(() => {
            result.current.submit();
        });

        expect(resolve).toHaveBeenCalledWith(null);
        expect(result.current.pending).toBeNull();
    });

    it('cancel resolves with null and clears pending', () => {
        const { result } = renderHook(() => usePromptDialog());
        const resolve = vi.fn();

        act(() => {
            mockOnPromptReturn({ id: 'p5', message: 'Enter', initialValue: 'data', resolve });
        });
        act(() => {
            result.current.cancel();
        });

        expect(resolve).toHaveBeenCalledWith(null);
        expect(result.current.pending).toBeNull();
        expect(result.current.value).toBe('');
    });

    it('a new prompt resolves the previous pending with null before replacing it', () => {
        const { result } = renderHook(() => usePromptDialog());
        const firstResolve = vi.fn();
        const secondResolve = vi.fn();

        act(() => {
            mockOnPromptReturn({ id: 'p-first', message: 'First', resolve: firstResolve });
        });
        // Second prompt arrives before the first is resolved.
        act(() => {
            mockOnPromptReturn({ id: 'p-second', message: 'Second', resolve: secondResolve });
        });

        // The first prompt was resolved with null (displaced).
        expect(firstResolve).toHaveBeenCalledWith(null);
        // The current pending is the second.
        expect(result.current.pending?.id).toBe('p-second');
    });
});
