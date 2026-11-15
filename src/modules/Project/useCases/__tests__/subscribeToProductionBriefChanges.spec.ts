import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { subscribeToProductionBriefChanges } from '../subscribeToProductionBriefChanges';

function replaceBrief(createdAt: number): void {
    const state = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...state, productionBrief: createDefaultProductionBrief(createdAt) });
}

function renameProject(): void {
    const state = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...state, name: 'Renamed' });
}

describe('subscribeToProductionBriefChanges', () => {
    afterEach(() => {
        projectStore.set(structuredClone(defaultProjectStoreState));
    });

    it('fires when the production brief is replaced', () => {
        const listener = vi.fn();
        const stop = subscribeToProductionBriefChanges(listener);

        replaceBrief(1);

        expect(listener).toHaveBeenCalledTimes(1);
        stop();
    });

    it('fires once for a brief replacement followed by a write to another field', () => {
        const listener = vi.fn();
        const stop = subscribeToProductionBriefChanges(listener);

        replaceBrief(3);
        renameProject();

        expect(listener).toHaveBeenCalledTimes(1);
        stop();
    });

    it('stays silent for a write to another project field and after unsubscribing', () => {
        const listener = vi.fn();
        const stop = subscribeToProductionBriefChanges(listener);

        renameProject();
        expect(listener).not.toHaveBeenCalled();

        stop();
        replaceBrief(2);
        expect(listener).not.toHaveBeenCalled();
    });
});
