import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { createStore } from './createStore';
import { useStore } from './useStore';
import { getController } from './internal/getController';

describe('useStore', () => {
    it('returns the current snapshot and re-renders on change', () => {
        const store = createStore({ count: 0 });
        const controller = getController(store);
        let renderCount = 0;

        const TestComponent = () => {
            const state = useStore(store);
            renderCount++;
            return <div data-testid="count">{state.count}</div>;
        };

        const { getByTestId } = render(<TestComponent />);
        expect(getByTestId('count').textContent).toBe('0');
        expect(renderCount).toBe(1);

        act(() => {
            controller.update(prev => ({ count: prev.count + 1 }));
        });

        expect(getByTestId('count').textContent).toBe('1');
        expect(renderCount).toBe(2);
    });

    it('does not re-render on no-op write', () => {
        const initialState = { count: 0 };
        const store = createStore(initialState);
        const controller = getController(store);
        let renderCount = 0;

        const TestComponent = () => {
            useStore(store);
            renderCount++;
            return null;
        };

        render(<TestComponent />);
        expect(renderCount).toBe(1);

        act(() => {
            controller.set(initialState);
        });

        expect(renderCount).toBe(1);
    });
});
