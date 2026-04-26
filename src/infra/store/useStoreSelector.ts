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

    // eslint-disable-next-line react-hooks/refs -- intentional: update ref synchronously during render to capture latest selector/equalityFn, avoiding stale-closure issues in getSnapshot
    stateRef.current.selector = selector;
    // eslint-disable-next-line react-hooks/refs -- same as above
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
