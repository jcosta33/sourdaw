import { describe, it, expect, beforeEach } from 'vitest';

import { createDefaultKit } from '../../models/ToasterKit';
import {
    toasterStore,
    defaultToasterState,
    registerToasterDevice,
    unregisterToasterDevice,
    resetToasterDeviceLifecycleState,
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

describe('updateKit defers writes made while the device is still loading', () => {
    beforeEach(() => {
        toasterStore.set({});
        // The queue and retire set are module-level; resetting them keeps the
        // block independent of declaration order (test 4 retires the id the
        // earlier tests write to).
        resetToasterDeviceLifecycleState();
    });

    it('a knob write that lands before registration is applied once the device loads, not dropped', () => {
        // Reproduces the Groove-knob drop: the panel mounts as soon as the device
        // sits on its track, while the WASM node — and with it the
        // `audioDevice.loaded` registration — is still in flight. The engine side
        // of the same write is deferred through the loading placeholder's
        // pendingParams; the store side must defer it too instead of dropping it.
        updateKit('dev-loading', { swing: 0.37 });

        registerToasterDevice('dev-loading');

        expect(toasterStore.value?.['dev-loading']?.kit.swing).toBe(0.37);
    });

    it('deferred writes merge across params and the latest value per param wins', () => {
        updateKit('dev-loading', { swing: 0.1 });
        updateKit('dev-loading', { swing: 0.9 });
        updateKit('dev-loading', { masterGain: 1.4 });

        registerToasterDevice('dev-loading');

        expect(toasterStore.value?.['dev-loading']?.kit.swing).toBe(0.9);
        expect(toasterStore.value?.['dev-loading']?.kit.masterGain).toBe(1.4);
    });

    it('deferred writes land on top of the registration kit, keeping its other fields', () => {
        const projectKit = { ...createDefaultKit(), swing: 0.5, masterGain: 0.8 };
        updateKit('dev-loading', { swing: 0.37 });

        registerToasterDevice('dev-loading', projectKit);

        expect(toasterStore.value?.['dev-loading']?.kit.swing).toBe(0.37);
        expect(toasterStore.value?.['dev-loading']?.kit.masterGain).toBe(0.8);
    });

    it('a write arriving after teardown stays refused and never reaches the next reload', () => {
        // Teardown retires the id. A reload of the same id rehydrates project
        // truth, so a stale write queued after teardown would corrupt it.
        registerToasterDevice('dev-loading');
        unregisterToasterDevice('dev-loading');

        updateKit('dev-loading', { swing: 0.9 });

        const reloadKit = { ...createDefaultKit(), swing: 0.5 };
        registerToasterDevice('dev-loading', reloadKit);

        expect(toasterStore.value?.['dev-loading']?.kit.swing).toBe(0.5);
    });

    it('teardown during the load window drops the queue and retires the id anyway', () => {
        // unregisterToasterDevice fires on audioDevice.removed regardless of
        // registration state; a device removed while still loading has queued
        // writes but no record. Undo restoring the CRDT device re-registers
        // the same id with project truth, which the stale write must not hit.
        updateKit('dev-loading', { swing: 0.9 });
        unregisterToasterDevice('dev-loading');

        const reloadKit = { ...createDefaultKit(), swing: 0.5 };
        registerToasterDevice('dev-loading', reloadKit);

        expect(toasterStore.value?.['dev-loading']?.kit.swing).toBe(0.5);
    });

    it('resetToasterDeviceLifecycleState ends both lifetimes at the project boundary', () => {
        // A write queued in project A's loading window must not flush onto
        // project B's same-id device, and a teardown in project A must not
        // refuse project B's loading-window writes: reloads reuse persisted
        // uuid device ids across project switches.
        updateKit('dev-shared', { swing: 0.9 });
        registerToasterDevice('dev-retired');
        unregisterToasterDevice('dev-retired');

        resetToasterDeviceLifecycleState();

        const reloadKit = { ...createDefaultKit(), swing: 0.5 };
        registerToasterDevice('dev-shared', reloadKit);
        expect(toasterStore.value?.['dev-shared']?.kit.swing).toBe(0.5);

        updateKit('dev-retired', { swing: 0.37 });
        registerToasterDevice('dev-retired', reloadKit);
        expect(toasterStore.value?.['dev-retired']?.kit.swing).toBe(0.37);
    });
});
