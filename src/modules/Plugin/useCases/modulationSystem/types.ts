/**
 * Modulation system store and accessors.
 *
 * Note: Audio-rate wiring (LFO, envelope, random at sample rate) is deferred
 * to the AudioWorklet modulation pipeline feature.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type ModulationSource, type ModulationRoute } from '#/modules/Plugin/models/ModulationTypes';

export type {
    ModulationSourceType,
    ModulationSource,
    ModulationTarget,
    ModulationRoute,
} from '#/modules/Plugin/models/ModulationTypes';
export { DEFAULT_MOD_PARAMS } from '#/modules/Plugin/models/ModulationTypes';

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
