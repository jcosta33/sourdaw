import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import {
    arrangementStore,
    defaultArrangementId,
    defaultArrangementStoreState,
    type ArrangementStoreState,
} from '../../../stores/arrangementStore';
import { duplicateArrangement } from '../duplicateArrangement';

// A canonical RFC-4122 UUID after the `arr-` prefix. The previous implementation
// truncated to `crypto.randomUUID().slice(0, 8)` (an 8-hex-char id with a high
// collision risk at scale); this regression pins the full-UUID id.
const ARRANGEMENT_ID_PATTERN = /^arr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function seed(): void {
    arrangementStore.set(structuredClone(defaultArrangementStoreState));
}

describe('duplicateArrangement', () => {
    beforeEach(() => {
        seed();
    });

    afterEach(() => {
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
    });

    it('assigns the clone a full-UUID id distinct from the source', () => {
        duplicateArrangement(defaultArrangementId, 'Copy');

        const state = arrangementStore.value as ArrangementStoreState;
        const clone = state.arrangements.find((arrangement) => arrangement.name === 'Copy');
        expect(clone).toBeDefined();
        expect(clone?.id).toMatch(ARRANGEMENT_ID_PATTERN);
        expect(clone?.id).not.toBe(defaultArrangementId);
        expect(state.activeArrangementId).toBe(clone?.id);
    });

    it('does not collide across repeated duplications of the same source', () => {
        const ids = new Set<string>();
        for (let index = 0; index < 200; index++) {
            duplicateArrangement(defaultArrangementId, `Copy ${String(index)}`);
            ids.add((arrangementStore.value as ArrangementStoreState).activeArrangementId);
        }
        expect(ids.size).toBe(200);
    });
});
