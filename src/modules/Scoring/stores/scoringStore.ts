/**
 * Scoring tuner state store.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type TunerState, type DisplayMode, DEFAULT_TUNER_STATE } from '../models/ScoringState';

const logger = Container.getInstance().get(Logger);

export const scoringStore = new Store<TunerState>(logger, {
    initialData: { ...DEFAULT_TUNER_STATE },
});

export function updateTunerTelemetry(data: Partial<TunerState>): void {
    const state = scoringStore.value;
    if (state) {
        scoringStore.set({ ...state, ...data });
    }
}

export function setDisplayMode(mode: DisplayMode): void {
    const state = scoringStore.value;
    if (state) {
        scoringStore.set({ ...state, mode });
    }
}

export function setA4Reference(hz: number): void {
    const state = scoringStore.value;
    if (state) {
        scoringStore.set({ ...state, a4Reference: hz });
    }
}
