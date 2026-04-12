/**
 * Grand Boule piano state store.
 *
 * Holds the current per-instance configuration, the preset parameter values
 * that have been applied, and a runtime-ready flag. Project-persistable.
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
    /** MIDI controller calibration per spec §3.1. */
    midiCalibration: GrandBouleMidiCalibration;
    /** Per-note parameter overrides per spec §3.1. */
    perNoteOverrides: GrandBoulePerNoteMap;
    /** Morph/layer state per spec §3.1. */
    morph: GrandBouleMorphState;
    /** Active historical temperament per spec §4. */
    temperament: TemperamentIndex;
    /** True once the WASM engine has been constructed and is accepting notes. */
    engineReady: boolean;
    /** Number of voices currently sounding (telemetry — read-only). */
    activeVoices: number;
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
        engineReady: false,
        activeVoices: 0,
    };
}

/** @deprecated Use createDefaultGrandBouleState() for fresh instances */
export const defaultGrandBouleState: GrandBouleState = createDefaultGrandBouleState();

export const grandBouleStore = createStore<GrandBouleState>({
    initialData: createDefaultGrandBouleState(),
});
