import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore, modulationStore } from '#/modules/Automation/stores';
import { cvGateStore } from '#/modules/CvGate/stores';
import { kneadStore } from '#/modules/Knead/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { arrangementStore, projectStore } from '#/modules/Project/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';

import { actionHistoryStore } from '../../../stores/actionHistoryStore';
import { projectCrdtToStores } from '../projectProjection';

// Class guard for audit CC-4. A `createAutomergeStorage(DOC_PREFIX_ROOT, <slot>)`
// call makes a slot part of collaborative project truth: written to the doc,
// persisted, and broadcast to peers. If `projectCrdtToStores` never reads that
// slot back, it becomes a write-only truth cell — the exact defect (`modulation`)
// this campaign fixes. These two tests make the next such slot fail CI:
//   1. Source enumeration ⇔ owner map: a new root slot must be mapped here.
//   2. The mapped store is actually hydrated by the real projection.

type HydratableStore = { hydrate: () => void };

/**
 * Every CRDT-backed root slot mapped to the store that owns it. The bijection
 * test asserts these keys exactly match the slots constructed in source, so
 * adding a `createAutomergeStorage(DOC_PREFIX_ROOT, 'newSlot')` without wiring
 * it here fails immediately.
 */
const SLOT_OWNER: Record<string, HydratableStore> = {
    tracks: trackStore,
    takeLanes: takeLaneStore,
    markers: markerStore,
    automation: automationStore,
    modulation: modulationStore,
    transport: transportStore,
    tempoMap: tempoMapStore,
    timeSignatureMap: timeSignatureMapStore,
    cvGate: cvGateStore,
    knead: kneadStore,
    actionHistory: actionHistoryStore,
    midi: midiStore,
    arrangements: arrangementStore,
    projectMeta: projectStore,
    sidechainRoutes: sidechainStore,
};

/**
 * Slots whose projection consumer intentionally rebuilds the store from another
 * store rather than hydrating its own slot, so the store's own `hydrate()` is
 * not the projection entry point. Keep this minimal and justified:
 * - `knead` is derived from `trackStore` clip state (see hydrateKneadFromTrackStore).
 */
const DERIVED_SLOTS = new Set<string>(['knead']);

function scanRootSlots(): Set<string> {
    const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
        query: '?raw',
        import: 'default',
        eager: true,
    });
    const slotPattern = /createAutomergeStorage\(\s*(?:DOC_PREFIX_ROOT|['"]root['"])\s*,\s*['"]([^'"]+)['"]/g;
    const slots = new Set<string>();
    for (const [path, source] of Object.entries(sources)) {
        if (path.includes('/__tests__/') || path.includes('.spec.')) {
            continue;
        }
        for (const match of source.matchAll(slotPattern)) {
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

    it('maps every CRDT-backed root slot constructed in source to an owning store', () => {
        const scanned = [...scanRootSlots()].sort();

        expect(scanned.length).toBeGreaterThan(0);
        expect(scanned).toEqual(Object.keys(SLOT_OWNER).sort());
    });

    it('hydrates every non-derived CRDT-backed root store through projectCrdtToStores', () => {
        // Without a configured document every hydrate() is a no-op; the spies
        // only observe that projection dispatches to each owning store.
        configureAutomergeStoragePort(null);
        const spies = new Map<string, MockInstance>();
        for (const [slot, store] of Object.entries(SLOT_OWNER)) {
            spies.set(slot, vi.spyOn(store, 'hydrate'));
        }

        try {
            projectCrdtToStores();

            for (const [slot, spy] of spies) {
                if (DERIVED_SLOTS.has(slot)) {
                    continue;
                }
                expect(spy, `projectCrdtToStores must hydrate the '${slot}' slot's store`).toHaveBeenCalled();
            }
        } finally {
            for (const spy of spies.values()) {
                spy.mockRestore();
            }
        }
    });
});
