import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { eventBus } from '#/app/registerDependencies';

import { createGrandBouleStore, resetGrandBouleStores } from '../../../stores/grandBouleStore';
import { GrandBoulePanel } from '../GrandBoulePanel';

// Render with the typed default so the panel mounts (and its subscription
// effect runs) without depending on the global useStore blob. The subscription
// writes the *real* per-device store, which each test reads directly.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

/**
 * Behavioural tests for the panel's MIDI pedal-CC subscription.
 *
 * #2: pedal values arrive as `number | boolean` and must be narrowed at runtime
 *     and clamped through the pedal use cases — never `as`-cast straight into
 *     the store.
 * #3: the subscription must re-bind when the `deviceId` prop changes so a
 *     re-keyed panel writes the new device's store, not the stale one.
 */

describe('GrandBoulePanel MIDI pedal subscription', () => {
    beforeEach(() => {
        resetGrandBouleStores();
    });

    it('coerces a boolean CC64 value to a clamped numeric sustain position (#2)', async () => {
        const deviceId = 'panel-midi-A';
        render(<GrandBoulePanel deviceId={deviceId} />);
        const store = createGrandBouleStore(deviceId);

        await eventBus.emit('midi.pedalCc', { deviceId, cc: 64, value: true });

        // A boolean true is mapped to the fully-engaged numeric position, not
        // written as the boolean itself.
        expect(store.value?.pedals.sustain).toBe(1);
        expect(typeof store.value?.pedals.sustain).toBe('number');
    });

    it('coerces a numeric CC66 value to a boolean sostenuto state (#2)', async () => {
        const deviceId = 'panel-midi-B';
        render(<GrandBoulePanel deviceId={deviceId} />);
        const store = createGrandBouleStore(deviceId);

        await eventBus.emit('midi.pedalCc', { deviceId, cc: 66, value: 1 });

        expect(store.value?.pedals.sostenuto).toBe(true);
        expect(typeof store.value?.pedals.sostenuto).toBe('boolean');
    });

    it('writes una corda (CC67) as a boolean from a numeric value (#2)', async () => {
        const deviceId = 'panel-midi-C';
        render(<GrandBoulePanel deviceId={deviceId} />);
        const store = createGrandBouleStore(deviceId);

        await eventBus.emit('midi.pedalCc', { deviceId, cc: 67, value: 0 });
        expect(store.value?.pedals.unaCorda).toBe(false);

        await eventBus.emit('midi.pedalCc', { deviceId, cc: 67, value: 1 });
        expect(store.value?.pedals.unaCorda).toBe(true);
    });

    it('re-subscribes to the new device when the deviceId prop changes (#3)', async () => {
        const deviceA = 'panel-midi-old';
        const deviceB = 'panel-midi-new';
        const { rerender } = render(<GrandBoulePanel deviceId={deviceA} />);

        rerender(<GrandBoulePanel deviceId={deviceB} />);

        const storeA = createGrandBouleStore(deviceA);
        const storeB = createGrandBouleStore(deviceB);

        await eventBus.emit('midi.pedalCc', { deviceId: deviceB, cc: 64, value: 0.5 });

        // The new device's store is updated; the old device's is untouched.
        expect(storeB.value?.pedals.sustain).toBe(0.5);
        expect(storeA.value?.pedals.sustain).toBe(0);
    });
});
