/**
 * Modulation system types and state.
 *
 * Note: Audio-rate wiring (LFO, envelope, random at sample rate) is deferred
 * to the AudioWorklet modulation pipeline feature.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

export type ModulationSourceType = 'lfo' | 'envelope' | 'midi-cc' | 'macro' | 'random' | 'step-seq';

export type ModulationSource = {
    id: string;
    type: ModulationSourceType;
    name: string;
    /** LFO rate in Hz, envelope times, CC number, etc. */
    parameters: Record<string, number>;
};

export type ModulationTarget = {
    deviceId: string;
    parameterName: string;
};

export type ModulationRoute = {
    id: string;
    sourceId: string;
    target: ModulationTarget;
    amount: number; // -1 to +1
    bipolar: boolean;
};

type ModulationState = {
    sources: Record<string, ModulationSource>;
    routes: Record<string, ModulationRoute>;
};

const logger = Container.getInstance().get(Logger);

export const modulationStore = new Store<ModulationState>(logger, {
    initialData: { sources: {}, routes: {} },
});

/** Backwards-compatible accessor — returns a live view as a Map. */
export const modulationSources = {
    get(id: string): ModulationSource | undefined {
        return modulationStore.value?.sources[id];
    },
    has(id: string): boolean {
        return id in (modulationStore.value?.sources ?? {});
    },
    get size(): number {
        return Object.keys(modulationStore.value?.sources ?? {}).length;
    },
    values(): ModulationSource[] {
        return Object.values(modulationStore.value?.sources ?? {});
    },
    set(id: string, source: ModulationSource): void {
        const current = modulationStore.value;
        if (!current) {
            return;
        }
        modulationStore.set({
            ...current,
            sources: { ...current.sources, [id]: source },
        });
    },
    delete(id: string): void {
        const current = modulationStore.value;
        if (!current) {
            return;
        }
        const { [id]: _, ...rest } = current.sources;
        modulationStore.set({ ...current, sources: rest });
    },
};

/** Backwards-compatible accessor for routes. */
export const modulationRoutes = {
    get(id: string): ModulationRoute | undefined {
        return modulationStore.value?.routes[id];
    },
    values(): ModulationRoute[] {
        return Object.values(modulationStore.value?.routes ?? {});
    },
    set(id: string, route: ModulationRoute): void {
        const current = modulationStore.value;
        if (!current) {
            return;
        }
        modulationStore.set({
            ...current,
            routes: { ...current.routes, [id]: route },
        });
    },
    delete(id: string): void {
        const current = modulationStore.value;
        if (!current) {
            return;
        }
        const { [id]: _, ...rest } = current.routes;
        modulationStore.set({ ...current, routes: rest });
    },
};

/** Default parameters per modulation source type */
export const DEFAULT_MOD_PARAMS: Record<ModulationSourceType, Record<string, number>> = {
    lfo: { rate: 1, depth: 1, phase: 0, waveform: 0 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.5 },
    'midi-cc': { cc: 1, channel: 0 },
    macro: { value: 0.5 },
    random: { rate: 4, smoothing: 0.5 },
    'step-seq': { steps: 8, rate: 1 },
};

