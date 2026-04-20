import { useSyncExternalStore, useRef, useCallback } from 'react';

import { type Store } from './types';

export function useStoreSelector<TData, TSelected>(
    store: Store<TData>,
    selector: (state: TData | null) => TSelected,
    equalityFn: (a: TSelected, b: TSelected) => boolean = Object.is
): TSelected {
    const stateRef = useRef<{
        selector: (state: TData | null) => TSelected;
        equalityFn: (a: TSelected, b: TSelected) => boolean;
        lastSnapshot: TData | null | undefined;
        lastSelection: TSelected | undefined;
    }>({
        selector,
        equalityFn,
        lastSnapshot: undefined,
        lastSelection: undefined,
    });

    stateRef.current.selector = selector;
    stateRef.current.equalityFn = equalityFn;

    const getSnapshot = useCallback(() => {
        const nextSnapshot = store.getSnapshot();
        const currentRef = stateRef.current;

        if (nextSnapshot === currentRef.lastSnapshot && currentRef.lastSelection !== undefined) {
            return currentRef.lastSelection;
        }

        const nextSelection = currentRef.selector(nextSnapshot);

        if (currentRef.lastSelection !== undefined && currentRef.equalityFn(currentRef.lastSelection, nextSelection)) {
            currentRef.lastSnapshot = nextSnapshot;
            return currentRef.lastSelection;
        }

        currentRef.lastSnapshot = nextSnapshot;
        currentRef.lastSelection = nextSelection;
        return nextSelection;
    }, [store]);

    return useSyncExternalStore(store.subscribeReact, getSnapshot);
}
