import { describe, it, expect, beforeEach } from 'vitest';

import { createDefaultKit } from '../../models/ToasterKit';
import {
    toasterStore,
    defaultToasterState,
    registerToasterDevice,
    unregisterToasterDevice,
    updatePad,
    updateKit,
    loadKit,
    selectPad,
    toggleStep,
    setStepVelocity,
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
        expect(toasterStore.value?.dev1?.kit.pads[0]?.tune).toBe(5);

        updateKit('dev1', { swing: 0.42 });
        expect(toasterStore.value?.dev1?.kit.swing).toBe(0.42);
    });

    it('selectPad does not resurrect an unregistered device', () => {
        // Regression: selectPad used to fall back to defaultToasterState for an
        // unknown deviceId and write it back, recreating a never-registered device.
        selectPad('ghost', 1);
        expect(toasterStore.value).toEqual({});
        expect(toasterStore.value?.ghost).toBeUndefined();
    });

    it('toggleStep does not resurrect a torn-down device', () => {
        toasterStore.set({ dev1: { ...defaultToasterState, kit: createDefaultKit() } });
        unregisterToasterDevice('dev1');
        expect(toasterStore.value?.dev1).toBeUndefined();

        toggleStep('dev1', 0, 0);

        expect(toasterStore.value?.dev1).toBeUndefined();
        expect(toasterStore.value).toEqual({});
    });

    it('setStepVelocity does not resurrect a torn-down device', () => {
        toasterStore.set({ dev2: { ...defaultToasterState, kit: createDefaultKit() } });
        unregisterToasterDevice('dev2');
        expect(toasterStore.value?.dev2).toBeUndefined();

        setStepVelocity('dev2', 0, 0, 0.5);

        expect(toasterStore.value?.dev2).toBeUndefined();
        expect(toasterStore.value).toEqual({});
    });

    it('selectPad still selects a pad on a registered device (happy path)', () => {
        toasterStore.set({ dev1: { ...defaultToasterState, kit: createDefaultKit() } });

        selectPad('dev1', 3);
        expect(toasterStore.value?.dev1?.selectedPadIndex).toBe(3);
    });
});

describe('registerToasterDevice', () => {
    beforeEach(() => {
        toasterStore.set({});
    });

    it('creates the record the mutators require, so an edit survives instead of no-opping', () => {
        registerToasterDevice('dev1');

        updateKit('dev1', { swing: 0.25 });
        updatePad('dev1', 1, { tune: -3 });

        expect(toasterStore.value?.dev1?.kit.swing).toBe(0.25);
        expect(toasterStore.value?.dev1?.kit.pads[1]?.tune).toBe(-3);
    });

    it('is idempotent — re-registering keeps the edits the record already holds', () => {
        registerToasterDevice('dev1');
        updateKit('dev1', { swing: 0.6 });

        registerToasterDevice('dev1');

        expect(toasterStore.value?.dev1?.kit.swing).toBe(0.6);
    });

    it('gives each device its own kit, so an edit on one does not reach the other', () => {
        registerToasterDevice('dev1');
        registerToasterDevice('dev2');

        updatePad('dev1', 0, { tune: 11 });

        expect(toasterStore.value?.dev1?.kit.pads[0]?.tune).toBe(11);
        expect(toasterStore.value?.dev2?.kit.pads[0]?.tune).not.toBe(11);
    });

    it('unregister then write still refuses — creation is registration, never a write', () => {
        registerToasterDevice('dev1');
        unregisterToasterDevice('dev1');

        updateKit('dev1', { swing: 0.7 });
        toggleStep('dev1', 0, 0);

        expect(toasterStore.value?.dev1).toBeUndefined();
        expect(toasterStore.value).toEqual({});
    });
});
