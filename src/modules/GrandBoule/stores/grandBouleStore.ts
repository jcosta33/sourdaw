/**
 * Grand Boule piano state store.
 *
 * Holds the current per-instance configuration, the preset parameter values
 * that have been applied, and a runtime-ready flag. Project-persistable.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import {
    type GrandBouleConfig,
    createDefaultGrandBouleConfig,
} from '../models/GrandBouleConfig';
import {
    type GrandBoulePresetParameters,
    createNeutralPresetParameters,
} from '../models/GrandBoulePreset';

const logger = Container.getInstance().get(Logger);

export type GrandBoulePedalState = {
    /** Sustain pedal (CC64) — continuous, 0..1. */
    sustain: number;
    /** Una corda (CC67) — binary. */
    unaCorda: boolean;
    /** Sostenuto (CC66) — binary. */
    sostenuto: boolean;
};

export type GrandBouleState = {
    config: GrandBouleConfig;
    parameters: GrandBoulePresetParameters;
    pedals: GrandBoulePedalState;
    /** True once the WASM engine has been constructed and is accepting notes. */
    engineReady: boolean;
    /** Number of voices currently sounding (telemetry — read-only). */
    activeVoices: number;
};

export const grandBouleStore = new Store<GrandBouleState>(logger, {
    initialData: {
        config: createDefaultGrandBouleConfig(),
        parameters: createNeutralPresetParameters(),
        pedals: {
            sustain: 0,
            unaCorda: false,
            sostenuto: false,
        },
        engineReady: false,
        activeVoices: 0,
    },
});
