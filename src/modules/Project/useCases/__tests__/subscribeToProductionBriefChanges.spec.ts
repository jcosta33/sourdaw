import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { subscribeToProductionBriefChanges } from '../subscribeToProductionBriefChanges';

describe('subscribeToProductionBriefChanges', () => {
    afterEach(() => {
        projectStore.set(structuredClone(defaultProjectStoreState));
    });

    it('fires when the production brief is replaced', () => {
        const listener = vi.fn();
        const stop = subscribeToProductionBriefChanges(listener);

        projectStore.update((state) => ({
            ...(state ?? defaultProjectStoreState),
            productionBrief: createDefaultProductionBrief('2026-01-01T00:00:00.000Z'),
        }));

        expect(listener).toHaveBeenCalledTimes(1);
        stop();
    });

    it('stays silent for a write to another project field and after unsubscribing', () => {
        const listener = vi.fn();
        const stop = subscribeToProductionBriefChanges(listener);

        projectStore.update((state) => ({ ...(state ?? defaultProjectStoreState), name: 'Renamed' }));
        expect(listener).not.toHaveBeenCalled();

        stop();
        projectStore.update((state) => ({
            ...(state ?? defaultProjectStoreState),
            productionBrief: createDefaultProductionBrief('2026-02-02T00:00:00.000Z'),
        }));
        expect(listener).not.toHaveBeenCalled();
    });
});
