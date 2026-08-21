/**
 * Grand Boule piano state store.
 *
 * Holds the current per-instance configuration and the preset parameter values
 * that have been applied. Project-persistable. Engine readiness and live voice
 * count are derived from the engine handle at render time, not stored here.
 */

import { createStore } from '#/infra/store/createStore';

import { type GrandBouleConfig, createDefaultGrandBouleConfig } from '../models/GrandBouleConfig';
import { type GrandBouleMidiCalibration, createDefaultMidiCalibration } from '../models/GrandBouleMidiCalibration';
import { type GrandBouleMorphState, createDefaultMorphState } from '../models/GrandBouleMorphState';
import { type GrandBoulePerNoteMap } from '../models/GrandBoulePerNoteParams';
import { type GrandBoulePresetParameters, createNeutralPresetParameters } from '../models/GrandBoulePreset';

export type GrandBoulePedalState = {
    /** Sustain pedal (CC64) — continuous, 0..1. */
    sustain: number;
    /** Una corda (CC67) — binary. */
    unaCorda: boolean;
    /** Sostenuto (CC66) — binary. */
    sostenuto: boolean;
};

/**
 * Historical temperament index. Matches the Rust enum `Temperament` values.
 * 0 = Equal (default), 1 = Werckmeister III, 2 = Kirnberger III,
 * 3 = Vallotti, 4 = Young II, 5 = Meantone ¼-comma.
 */
export type TemperamentIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type GrandBouleState = {
    config: GrandBouleConfig;
    parameters: GrandBoulePresetParameters;
    pedals: GrandBoulePedalState;
    /** MIDI controller calibration. */
    midiCalibration: GrandBouleMidiCalibration;
    /** Per-note parameter overrides. */
    perNoteOverrides: GrandBoulePerNoteMap;
    /** Morph/layer state. */
    morph: GrandBouleMorphState;
    /** Active historical temperament. */
    temperament: TemperamentIndex;
};

export function createDefaultGrandBouleState(): GrandBouleState {
    return {
        config: createDefaultGrandBouleConfig(),
        parameters: createNeutralPresetParameters(),
        pedals: {
            sustain: 0,
            unaCorda: false,
            sostenuto: false,
        },
        midiCalibration: createDefaultMidiCalibration(),
        perNoteOverrides: new Map(),
        morph: createDefaultMorphState(),
        temperament: 0,
    };
}

/** @deprecated Use createDefaultGrandBouleState() for fresh instances */
export const defaultGrandBouleState: GrandBouleState = createDefaultGrandBouleState();

const storesByDevice = new Map<string, ReturnType<typeof createStore<GrandBouleState>>>();

export function createGrandBouleStore(deviceId: string) {
    let store = storesByDevice.get(deviceId);
    if (!store) {
        store = createStore<GrandBouleState>({
            initialData: createDefaultGrandBouleState(),
        });
        storesByDevice.set(deviceId, store);
    }
    return store;
}

/** @deprecated Use createGrandBouleStore(deviceId) instead. Shim for backwards compatibility. */
export const grandBouleStore = createGrandBouleStore('default');

/**
 * Clear all per-device Grand Boule stores.
 *
 * The per-device stores are separate `createStore` instances held in a module
 * Map (unlike the single `Record<deviceId, State>` stores other modules use,
 * which a `.set({})` clears wholesale). Project teardown must reset every
 * device's slice here, or a prior project's Grand Boule state leaks into a New
 * project.
 *
 * Every Map entry's value is reset to a fresh default in place rather than
 * dropping the entries, so any open panel still subscribed to its store keeps a
 * live, default-valued snapshot. The `grandBouleStore` shim is one of those
 * entries, so it is reset by the same loop — no separate call needed.
 */
export function resetGrandBouleStores(): void {
    for (const store of storesByDevice.values()) {
        store.set(createDefaultGrandBouleState());
    }
}
