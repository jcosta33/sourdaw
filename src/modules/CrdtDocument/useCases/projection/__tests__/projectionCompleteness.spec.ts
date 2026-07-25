import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { projectCrdtToStores } from '../projectProjection';
import { projectSlotProjections } from '../projectSlotProjections';

// Class guard for audit CC-4, kept honest for audit CC-1/CC-2.
//
// A `createAutomergeStorage(DOC_PREFIX_ROOT, <slot>)` call makes a slot part of
// collaborative project truth: written to the doc, persisted, and broadcast to
// peers. If nothing reads that slot back it becomes a write-only truth cell —
// the `modulation` data-loss defect. These tests make the next such slot fail:
//   1. Source enumeration ⇔ the production projection registry (bijection).
//   2. Every registry entry is actually dispatched by the real projection, and
//      lands on the store that owns the slot.
//
// The owner map is no longer maintained here: `projectSlotProjections` in
// production is the single source, so the two lists cannot drift apart.

/**
 * Matches every construction form in use, including the generic ones
 * (`createAutomergeStorage<YeastState>('root', 'yeast', …)`) that an earlier
 * name-only pattern silently skipped — `chordTrack`, `grooveTemplates` and
 * `yeast` were invisible to this guard.
 */
const SLOT_PATTERN = /createAutomergeStorage(?:<[^>]*>)?\(\s*(?:DOC_PREFIX_ROOT|['"]root['"])\s*,\s*['"]([^'"]+)['"]/g;

function scanRootSlots(): Set<string> {
    const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
        query: '?raw',
        import: 'default',
        eager: true,
    });
    const slots = new Set<string>();
    for (const [path, source] of Object.entries(sources)) {
        if (path.includes('/__tests__/') || path.includes('.spec.')) {
            continue;
        }
        for (const match of source.matchAll(SLOT_PATTERN)) {
            const slot = match[1];
            if (slot !== undefined) {
                slots.add(slot);
            }
        }
    }
    return slots;
}

describe('projection completeness (audit CC-4 class guard)', () => {
    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('registers exactly the CRDT-backed root slots constructed in source', () => {
        const scanned = [...scanRootSlots()].sort();
        const registered = projectSlotProjections.map((projection) => projection.slot).sort();

        expect(scanned.length).toBeGreaterThan(0);
        expect(registered).toEqual(scanned);
    });

    it('sees generic construction forms, not only the plain call', () => {
        // Pins the fix for the hole this guard shipped with: a generic type
        // argument used to hide a slot from the scan entirely.
        const generic = [...`createAutomergeStorage<YeastState>('root', 'yeast', {`.matchAll(SLOT_PATTERN)].map(
            (match) => match[1]
        );

        expect(generic).toEqual(['yeast']);
    });

    it('gives every registered slot exactly one projection consumer', () => {
        const slots = projectSlotProjections.map((projection) => projection.slot);

        expect(new Set(slots).size).toBe(slots.length);
    });

    it('dispatches every registered slot projection through projectCrdtToStores', () => {
        // Without a configured document every hydrate() is a no-op; the spies
        // only observe that projection dispatches to each owning store.
        configureAutomergeStoragePort(null);
        const spies = new Map<string, MockInstance>();
        for (const projection of projectSlotProjections) {
            if (projection.derivedFromSiblingSlot) {
                continue;
            }
            spies.set(projection.slot, vi.spyOn(projection.store, 'hydrate'));
        }

        try {
            projectCrdtToStores();

            for (const [slot, spy] of spies) {
                expect(spy, `projectCrdtToStores must hydrate the '${slot}' slot's store`).toHaveBeenCalled();
            }
        } finally {
            for (const spy of spies.values()) {
                spy.mockRestore();
            }
        }
    });

    it('routes a derived slot through the sibling slot that rebuilds it', () => {
        // `knead` is rebuilt from trackStore clip state, so its own store
        // hydrate is deliberately not the entry point — but a `tracks` change
        // must still trigger it, or the derived read model goes stale.
        for (const projection of projectSlotProjections) {
            if (!projection.derivedFromSiblingSlot) {
                continue;
            }
            expect(
                projection.triggerSlots.filter((trigger) => trigger !== projection.slot),
                `derived slot '${projection.slot}' must declare the sibling slot it is rebuilt from`
            ).not.toEqual([]);
        }
    });
});
