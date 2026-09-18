import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';

import { createGrandBouleStore, resetGrandBouleStores } from '../../../stores/grandBouleStore';
import { setGrandBouleEventBus, type GrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { GrandBoulePanel } from '../GrandBoulePanel';

// Render with the typed default so the panel mounts (and its subscription
// effect runs) without depending on the global useStore blob. The subscription
// writes the *real* per-device store, which each test reads directly.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

// The panel's own handle, with the three pedal writes spied. `isReady` is
// false, exactly as the disconnected handle the real resolver returns for an
// unrendered track, so nothing but a pedal write can reach these.
const pedalWrites = vi.hoisted(() => ({
    setSustain: vi.fn(),
    setSostenuto: vi.fn(),
    setUnaCorda: vi.fn(),
}));

vi.mock('../../../useCases/resolveGrandBouleEngine', () => ({
    resolveGrandBouleEngine: () => ({
        noteOn: () => {},
        noteOnMidi2: () => {},
        noteOff: () => {},
        setParam: () => {},
        setCalibration: () => {},
        setSustain: pedalWrites.setSustain,
        setUnaCorda: pedalWrites.setUnaCorda,
        setSostenuto: pedalWrites.setSostenuto,
        setTemperament: () => {},
        allNotesOff: () => {},
        isReady: () => false,
        getAnalyserNode: () => null,
        sampleRate: () => 48_000,
    }),
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

type TestBusEvents = {
    'track.added': import('#/modules/Arrangement/events').TrackAddedPayload;
    'midi.noteOn': import('#/modules/WorkspaceShell/events').MidiNoteOnPayload;
    'midi.noteOff': import('#/modules/WorkspaceShell/events').MidiNoteOffPayload;
    'midi.pedalCc': import('#/modules/WorkspaceShell/events').MidiPedalCcPayload;
};

type TestBusHandler<TEventName extends keyof TestBusEvents> = (
    payload: TestBusEvents[TEventName]
) => void | Promise<void>;

type TestBusHandlerSets = {
    [K in keyof TestBusEvents]: Set<TestBusHandler<K>>;
};

function createHandlerSets(): TestBusHandlerSets {
    return {
        'track.added': new Set<TestBusHandler<'track.added'>>(),
        'midi.noteOn': new Set<TestBusHandler<'midi.noteOn'>>(),
        'midi.noteOff': new Set<TestBusHandler<'midi.noteOff'>>(),
        'midi.pedalCc': new Set<TestBusHandler<'midi.pedalCc'>>(),
    };
}

let handlers = createHandlerSets();

function clearHandlers(): void {
    handlers = createHandlerSets();
}

const testEventBus: GrandBouleEventBus = {
    async emit<TEventName extends keyof TestBusEvents>(
        event: TEventName,
        payload: TestBusEvents[TEventName]
    ): Promise<void> {
        const eventHandlers = handlers[event];
        await Promise.all([...eventHandlers].map((handler) => Promise.resolve(handler(payload))));
    },
    on<TEventName extends keyof TestBusEvents>(event: TEventName, handler: TestBusHandler<TEventName>): () => void {
        const eventHandlers = handlers[event];
        eventHandlers.add(handler);
        return () => {
            eventHandlers.delete(handler);
        };
    },
};

describe('GrandBoulePanel MIDI pedal subscription', () => {
    beforeEach(() => {
        Container.clear();
        clearHandlers();
        setGrandBouleEventBus(testEventBus);
        resetGrandBouleStores();
        pedalWrites.setSustain.mockClear();
        pedalWrites.setSostenuto.mockClear();
        pedalWrites.setUnaCorda.mockClear();
    });

    it('coerces a boolean CC64 value to a clamped numeric sustain position (#2)', async () => {
        const deviceId = 'panel-midi-A';
        render(<GrandBoulePanel deviceId={deviceId} />);
        const store = createGrandBouleStore(deviceId);

        await testEventBus.emit('midi.pedalCc', { deviceId, cc: 64, value: true });

        // A boolean true is mapped to the fully-engaged numeric position, not
        // written as the boolean itself.
        expect(store.value?.pedals.sustain).toBe(1);
        expect(typeof store.value?.pedals.sustain).toBe('number');
    });

    it('coerces a numeric CC66 value to a boolean sostenuto state (#2)', async () => {
        const deviceId = 'panel-midi-B';
        render(<GrandBoulePanel deviceId={deviceId} />);
        const store = createGrandBouleStore(deviceId);

        await testEventBus.emit('midi.pedalCc', { deviceId, cc: 66, value: 1 });

        expect(store.value?.pedals.sostenuto).toBe(true);
        expect(typeof store.value?.pedals.sostenuto).toBe('boolean');
    });

    it('writes una corda (CC67) as a boolean from a numeric value (#2)', async () => {
        const deviceId = 'panel-midi-C';
        render(<GrandBoulePanel deviceId={deviceId} />);
        const store = createGrandBouleStore(deviceId);

        await testEventBus.emit('midi.pedalCc', { deviceId, cc: 67, value: 0 });
        expect(store.value?.pedals.unaCorda).toBe(false);

        await testEventBus.emit('midi.pedalCc', { deviceId, cc: 67, value: 1 });
        expect(store.value?.pedals.unaCorda).toBe(true);
    });

    it('echoes a physical pedal into the store alone, writing no body a second time', async () => {
        // `routePedalToBodies` already delivered this movement to both the Web
        // Audio node and the engine body. The panel's echo exists to keep its
        // own readout honest; writing the handle again would re-send the
        // identical value and queue a second native controller message for
        // every pedal movement the panel is open for.
        const deviceId = 'panel-midi-echo';
        render(<GrandBoulePanel deviceId={deviceId} />);
        const store = createGrandBouleStore(deviceId);

        await testEventBus.emit('midi.pedalCc', { deviceId, cc: 64, value: 1 });
        await testEventBus.emit('midi.pedalCc', { deviceId, cc: 66, value: 1 });
        await testEventBus.emit('midi.pedalCc', { deviceId, cc: 67, value: 1 });

        expect(store.value?.pedals).toEqual({ sustain: 1, sostenuto: true, unaCorda: true });
        expect(pedalWrites.setSustain).not.toHaveBeenCalled();
        expect(pedalWrites.setSostenuto).not.toHaveBeenCalled();
        expect(pedalWrites.setUnaCorda).not.toHaveBeenCalled();
    });

    it('re-subscribes to the new device when the deviceId prop changes (#3)', async () => {
        const deviceA = 'panel-midi-old';
        const deviceB = 'panel-midi-new';
        const { rerender } = render(<GrandBoulePanel deviceId={deviceA} />);

        rerender(<GrandBoulePanel deviceId={deviceB} />);

        const storeA = createGrandBouleStore(deviceA);
        const storeB = createGrandBouleStore(deviceB);

        await testEventBus.emit('midi.pedalCc', { deviceId: deviceB, cc: 64, value: 0.5 });

        // The new device's store is updated; the old device's is untouched.
        expect(storeB.value?.pedals.sustain).toBe(0.5);
        expect(storeA.value?.pedals.sustain).toBe(0);
    });
});
