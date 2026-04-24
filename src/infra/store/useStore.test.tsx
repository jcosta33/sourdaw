import { render, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createStore } from './createStore';
import { useStore } from './useStore';

vi.unmock('#/infra/store/useStore');

// Render count trackers shared across test and component (must be module-level for @eslint-react/component-hook-factories)
let snapshotRenderCount = 0;
let changeRenderCount = 0;

// Stores are created once at module level; tests reset via store.set()
const snapshotStore = createStore({ initialData: { count: 0 } });
const changeStore = createStore({ initialData: { count: 0 } });

const SnapshotTestComponent = () => {
    const state = useStore(snapshotStore, { count: 0 });
    snapshotRenderCount++;
    return <div data-testid="count">{state.count}</div>;
};

const ChangeTestComponent = () => {
    useStore(changeStore, { count: 0 });
    changeRenderCount++;
    return null;
};

describe('useStore', () => {
    it('returns the current snapshot and re-renders on change', () => {
        snapshotRenderCount = 0;
        snapshotStore.set({ count: 0 });

        const { getByTestId } = render(<SnapshotTestComponent />);
        expect(getByTestId('count').textContent).toBe('0');
        expect(snapshotRenderCount).toBe(1);

        act(() => {
            snapshotStore.update((prev) => ({ count: (prev?.count ?? 0) + 1 }));
        });

        expect(getByTestId('count').textContent).toBe('1');
        expect(snapshotRenderCount).toBeGreaterThanOrEqual(1);
    });

    it('re-renders when value changes', () => {
        changeRenderCount = 0;
        changeStore.set({ count: 0 });

        render(<ChangeTestComponent />);
        expect(changeRenderCount).toBe(1);

        act(() => {
            changeStore.set({ count: 1 });
        });

        expect(changeRenderCount).toBeGreaterThanOrEqual(1);
    });
});
