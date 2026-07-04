import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '../createStore';
import { type ReadableStore } from '../types';
import { useStoreSelector } from '../useStoreSelector';

vi.unmock('#/infra/store/useStoreSelector');

let selectorRenderCount = 0;

const selectorStore = createStore({ initialData: { count: 0, label: 'init' } });
const readonlySelectorStore: ReadableStore<{ count: number; label: string }> = {
    get value() {
        return selectorStore.value;
    },

    subscribe(callback) {
        return selectorStore.subscribe(callback);
    },

    subscribeReact(listener) {
        return selectorStore.subscribeReact(listener);
    },

    getSnapshot() {
        return selectorStore.getSnapshot();
    },
};

const ReadonlySelectorTestComponent = () => {
    const selection = useStoreSelector(
        readonlySelectorStore,
        (state) => `${state?.label ?? 'none'}:${state?.count ?? 0}`
    );
    selectorRenderCount++;
    return <div data-testid="selection">{selection}</div>;
};

describe('useStoreSelector', () => {
    it('should select from read-only store facades', () => {
        selectorRenderCount = 0;
        selectorStore.set({ count: 1, label: 'lead' });

        expect('set' in readonlySelectorStore).toBe(false);
        expect('update' in readonlySelectorStore).toBe(false);
        expect('clear' in readonlySelectorStore).toBe(false);
        expect('hydrate' in readonlySelectorStore).toBe(false);

        const { getByTestId } = render(<ReadonlySelectorTestComponent />);
        expect(getByTestId('selection').textContent).toBe('lead:1');
        expect(selectorRenderCount).toBe(1);

        act(() => {
            selectorStore.update((current) => ({ count: (current?.count ?? 0) + 1, label: current?.label ?? 'lead' }));
        });

        expect(getByTestId('selection').textContent).toBe('lead:2');
        expect(selectorRenderCount).toBeGreaterThanOrEqual(1);
    });
});
