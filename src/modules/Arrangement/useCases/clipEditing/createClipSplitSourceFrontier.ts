import { getChangesMetaSince, getHeads, view } from '@automerge/automerge';

import { valuesEqual } from '#/utils/structuralEquality';

type Root = Readonly<Record<string, unknown>>;

/** Call only on published truth before a backend change opens; history queries can settle an active candidate. */
export function createClipSplitSourceFrontier(
    root: Root,
    before: unknown,
    readOwners: (document: Root) => unknown | null
) {
    const basisHeads = getHeads(root).toSorted();
    return (document: Root): boolean => {
        const current = readOwners(document);
        if (current === null || !valuesEqual(current, before)) {
            return false;
        }
        const currentHeads = getHeads(document).toSorted();
        if (valuesEqual(currentHeads, basisHeads)) {
            return true;
        }
        try {
            const changes = new Map(getChangesMetaSince(document, basisHeads).map((change) => [change.hash, change]));
            const unreached = new Set(basisHeads);
            const pending = [...currentHeads];
            const visited = new Set<string>();
            while (pending.length > 0) {
                const hash = pending.pop();
                if (!hash || visited.has(hash)) {
                    continue;
                }
                visited.add(hash);
                if (unreached.delete(hash)) {
                    continue;
                }
                const change = changes.get(hash);
                if (!change) {
                    continue;
                }
                // A later restoration cannot hide an intervening source edit or incarnation.
                const previous = readOwners(view(document, change.deps));
                const next = readOwners(view(document, [hash]));
                if (previous === null || next === null || !valuesEqual(previous, next)) {
                    return false;
                }
                pending.push(...change.deps);
            }
            return unreached.size === 0;
        } catch {
            // Missing causal history cannot authorize this retained source.
            return false;
        }
    };
}
