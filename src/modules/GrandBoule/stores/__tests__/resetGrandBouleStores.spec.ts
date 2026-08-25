/**
 * Per-device Grand Boule store reset for project-switch isolation.
 *
 * Grand Boule keeps a Map of separate `createStore` instances keyed by device
 * id, not a single `Record<deviceId, State>` store. A project reset that only
 * `.set(default)` on the `'default'` shim leaves every *other* device's slice
 * intact, so a prior project's per-device Grand Boule state (pedals, calibration,
 * temperament, …) leaks into a New Project. `resetGrandBouleStores` must clear
 * every per-device store, not just the singleton.
 */
import { describe, it, expect } from 'vitest';

import { createDefaultGrandBouleState, createGrandBouleStore, resetGrandBouleStores } from '../grandBouleStore';

describe('resetGrandBouleStores', () => {
    it('resets a per-device (non-default) store to default, not just the default singleton', () => {
        // Simulate a project whose track hosts a Grand Boule with a non-default id.
        const deviceId = 'project-A-grand-boule-7';
        const store = createGrandBouleStore(deviceId);

        // Dirty this device's slice the way a loaded project would (engaged
        // sustain pedal + non-equal temperament).
        store.set({
            ...createDefaultGrandBouleState(),
            pedals: { sustain: 1, unaCorda: true, sostenuto: true },
            temperament: 3,
        });

        // Sanity: the dirty state is present before the reset.
        expect(store.value?.pedals.sustain).toBe(1);
        expect(store.value?.temperament).toBe(3);

        // Project teardown.
        resetGrandBouleStores();

        // The per-device slice must be back to default — before the fix, only the
        // 'default' singleton was reset and this device's state survived.
        expect(store.value).toEqual(createDefaultGrandBouleState());
        expect(store.value?.pedals).toEqual({ sustain: 0, unaCorda: false, sostenuto: false });
        expect(store.value?.temperament).toBe(0);
    });

    it('resets multiple per-device stores in one call', () => {
        const a = createGrandBouleStore('dev-a');
        const b = createGrandBouleStore('dev-b');
        a.set({ ...createDefaultGrandBouleState(), temperament: 2 });
        b.set({ ...createDefaultGrandBouleState(), temperament: 5 });

        resetGrandBouleStores();

        expect(a.value?.temperament).toBe(0);
        expect(b.value?.temperament).toBe(0);
    });
});
