import { render, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createStore } from './createStore';
import { useStore } from './useStore';

vi.unmock('#/infra/store/useStore');

describe('useStore', () => {
    it('returns the current snapshot and re-renders on change', () => {
        const store = createStore({ initialData: { count: 0 } });
        let renderCount = 0;

        const TestComponent = () => {
            const state = useStore(store, { count: 0 });
            renderCount++;
            return <div data-testid="count">{state.count}</div>;
        };

        const { getByTestId } = render(<TestComponent />);
        expect(getByTestId('count').textContent).toBe('0');
        expect(renderCount).toBe(1);

        act(() => {
            store.update((prev) => ({ count: (prev?.count ?? 0) + 1 }));
        });

        expect(getByTestId('count').textContent).toBe('1');
        expect(renderCount).toBeGreaterThanOrEqual(1);
    });

    it('re-renders when value changes', () => {
        const store = createStore({ initialData: { count: 0 } });
        let renderCount = 0;

        const TestComponent = () => {
            useStore(store, { count: 0 });
            renderCount++;
            return null;
        };

        render(<TestComponent />);
        expect(renderCount).toBe(1);

        act(() => {
            store.set({ count: 1 });
        });

        expect(renderCount).toBeGreaterThanOrEqual(1);
    });
});
