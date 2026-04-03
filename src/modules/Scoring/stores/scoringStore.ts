/**
 * Scoring tuner state store.
 * Keyed by deviceId to support multiple simultaneous instances.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type TunerState, type DisplayMode, DEFAULT_TUNER_STATE } from '../models/ScoringState';

const logger = Container.getInstance().get(Logger);

type ScoringInstances = Record<string, TunerState>;

export const scoringStore = new Store<ScoringInstances>(logger, { initialData: {} });

export function getScoringState(deviceId: string): TunerState {
    return scoringStore.value?.[deviceId] ?? { ...DEFAULT_TUNER_STATE };
}

export function updateTunerTelemetry(deviceId: string, data: Partial<TunerState>): void {
    const instances = scoringStore.value ?? {};
    const existing = instances[deviceId] ?? { ...DEFAULT_TUNER_STATE };
    scoringStore.set({ ...instances, [deviceId]: { ...existing, ...data } });
}

export function setDisplayMode(deviceId: string, mode: DisplayMode): void {
    const instances = scoringStore.value ?? {};
    const existing = instances[deviceId] ?? { ...DEFAULT_TUNER_STATE };
    scoringStore.set({ ...instances, [deviceId]: { ...existing, mode } });
}

export function setA4Reference(deviceId: string, hz: number): void {
    const instances = scoringStore.value ?? {};
    const existing = instances[deviceId] ?? { ...DEFAULT_TUNER_STATE };
    scoringStore.set({ ...instances, [deviceId]: { ...existing, a4Reference: hz } });
}
