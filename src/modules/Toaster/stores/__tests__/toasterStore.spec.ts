import { describe, it, expect, beforeEach } from 'vitest';

import { createDefaultKit } from '../../models/ToasterKit';
import {
    toasterStore,
    defaultToasterState,
    unregisterToasterDevice,
    updatePad,
    updateKit,
    loadKit,
    getToasterState,
} from '../toasterStore';

describe('toasterStore device-absence guards', () => {
    beforeEach(() => {
        toasterStore.set({});
    });

    it('updatePad does not resurrect an unregistered device', () => {
        // Regression: updatePad used to fall back to defaultToasterState for an
        // unknown deviceId and write it back, recreating a just-deleted device.
        updatePad('ghost', 0, { tune: 12 });
        expect(toasterStore.value).toEqual({});
        expect(toasterStore.value?.ghost).toBeUndefined();
    });

    it('updateKit does not resurrect an unregistered device', () => {
        updateKit('ghost', { swing: 0.5 });
        expect(toasterStore.value).toEqual({});
        expect(toasterStore.value?.ghost).toBeUndefined();
    });

    it('loadKit does not resurrect an unregistered device', () => {
        loadKit('ghost', createDefaultKit());
        expect(toasterStore.value).toEqual({});
        expect(toasterStore.value?.ghost).toBeUndefined();
    });

    it('a param write after teardown stays a no-op (delete then write)', () => {
        // Seed a real device, tear it down, then simulate a late param write
        // (e.g. a queued rAF flush firing after destroy()).
        toasterStore.set({ dev1: { ...defaultToasterState, kit: createDefaultKit() } });
        unregisterToasterDevice('dev1');
        expect(toasterStore.value?.dev1).toBeUndefined();

        updatePad('dev1', 0, { tune: 7 });
        updateKit('dev1', { swing: 0.3 });

        expect(toasterStore.value?.dev1).toBeUndefined();
        expect(toasterStore.value).toEqual({});
    });

    it('still updates a registered device (guard does not break the happy path)', () => {
        toasterStore.set({ dev1: { ...defaultToasterState, kit: createDefaultKit() } });

        updatePad('dev1', 0, { tune: 5 });
        expect(getToasterState('dev1').kit.pads[0]?.tune).toBe(5);

        updateKit('dev1', { swing: 0.42 });
        expect(getToasterState('dev1').kit.swing).toBe(0.42);
    });
});
