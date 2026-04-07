import { render, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { createStore } from './createStore';
import { useStore } from './useStore';

describe('useStore', () => {
    it('returns the current snapshot and re-renders on change', () => {
        const store = createStore({ initialData: { count: 0 } });
        let renderCount = 0;

        const TestComponent = () => {
            const state = useStore(store);
            renderCount++;
            return <div data-testid="count">{state?.count ?? 'null'}</div>;
        };

        const { getByTestId } = render(<TestComponent />);
        expect(getByTestId('count').textContent).toBe('0');
        expect(renderCount).toBe(1);

        act(() => {
            store.update((prev) => (prev ? { count: prev.count + 1 } : null));
        });

        expect(getByTestId('count').textContent).toBe('1');
        expect(renderCount).toBe(2);
    });

    it('re-renders when value changes', () => {
        const store = createStore({ initialData: { count: 0 } });
        let renderCount = 0;

        const TestComponent = () => {
            useStore(store);
            renderCount++;
            return null;
        };

        render(<TestComponent />);
        expect(renderCount).toBe(1);

        act(() => {
            store.set({ count: 1 });
        });

        expect(renderCount).toBe(2);
    });
});
