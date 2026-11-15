import { useSyncExternalStore, useRef, useCallback } from 'react';

import { type ReadableStore } from './types';

export function useStoreSelector<TData, TSelected>(
    store: ReadableStore<TData>,
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
    const selectorChanged = stateRef.current.selector !== selector;
    // eslint-disable-next-line react-hooks/refs -- same as above
    stateRef.current.selector = selector;
    // eslint-disable-next-line react-hooks/refs -- same as above
    stateRef.current.equalityFn = equalityFn;

    const getSnapshot = useCallback(() => {
        const nextSnapshot = store.getSnapshot();
        const currentRef = stateRef.current;

        // A new selector closure (e.g. one capturing a different clip id)
        // must re-run even when the store snapshot is unchanged — otherwise
        // the cached selection describes the previous closure's target.
        if (nextSnapshot === currentRef.lastSnapshot && currentRef.lastSelection !== undefined && !selectorChanged) {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- selectorChanged must
        // recreate getSnapshot for the render that saw the new closure; the ref
        // carries the latest selector for between-render store notifications.
    }, [store, selectorChanged]);

    return useSyncExternalStore(store.subscribeReact, getSnapshot);
}
