import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import {
    arrangementStore,
    defaultArrangementStoreState,
    type ArrangementStoreState,
} from '../../../stores/arrangementStore';
import { createArrangement } from '../createArrangement';

// A canonical RFC-4122 UUID after the `arr-` prefix. The previous implementation
// truncated to `crypto.randomUUID().slice(0, 8)` (an 8-hex-char id with a high
// collision risk at scale); this regression pins the full-UUID id.
const ARRANGEMENT_ID_PATTERN = /^arr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function seed(): void {
    arrangementStore.set(structuredClone(defaultArrangementStoreState));
}

describe('createArrangement', () => {
    beforeEach(() => {
        seed();
    });

    afterEach(() => {
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
    });

    it('assigns the new arrangement a full-UUID id (not an 8-char truncation)', () => {
        createArrangement('Verse');

        const state = arrangementStore.value as ArrangementStoreState;
        const created = state.arrangements.find((arrangement) => arrangement.name === 'Verse');
        expect(created).toBeDefined();
        expect(created?.id).toMatch(ARRANGEMENT_ID_PATTERN);
        expect(state.activeArrangementId).toBe(created?.id);
    });

    it('does not collide across repeated creations', () => {
        const ids = new Set<string>();
        for (let index = 0; index < 200; index++) {
            createArrangement(`Section ${String(index)}`);
            ids.add((arrangementStore.value as ArrangementStoreState).activeArrangementId);
        }
        expect(ids.size).toBe(200);
    });
});
