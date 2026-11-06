import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
    patchExternalPluginParameterValue,
} from '../externalPluginParameterStore';

const publishedParameter = (id: number, value: number) => ({
    id,
    name: `Parameter ${id}`,
    value,
    defaultValue: 0.5,
    minValue: 0,
    maxValue: 1,
    unit: '',
    isAutomatable: true,
});

describe('externalPluginParameterStore patchExternalPluginParameterValue', () => {
    afterEach(() => {
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
    });

    it('publishes a changed value to subscribers and updates the snapshot', () => {
        externalPluginParameterStore.set({
            byInstanceId: { 'inst-1': { engineAttached: true, parameters: [publishedParameter(7, 0.25)] } },
        });
        const listener = vi.fn();
        const unsubscribe = externalPluginParameterStore.subscribe(listener);

        patchExternalPluginParameterValue('inst-1', 7, 0.9);

        unsubscribe();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters[0]?.value).toBe(0.9);
    });

    it('publishes nothing when the parameter already holds the value', () => {
        externalPluginParameterStore.set({
            byInstanceId: { 'inst-1': { engineAttached: true, parameters: [publishedParameter(7, 0.25)] } },
        });
        const before = externalPluginParameterStore.value;
        const listener = vi.fn();
        const unsubscribe = externalPluginParameterStore.subscribe(listener);

        patchExternalPluginParameterValue('inst-1', 7, 0.25);

        unsubscribe();
        expect(listener).not.toHaveBeenCalled();
        expect(externalPluginParameterStore.value).toBe(before);
    });

    it('ignores an unknown instance or parameter without publishing', () => {
        externalPluginParameterStore.set({
            byInstanceId: { 'inst-1': { engineAttached: true, parameters: [publishedParameter(7, 0.25)] } },
        });
        const before = externalPluginParameterStore.value;
        const listener = vi.fn();
        const unsubscribe = externalPluginParameterStore.subscribe(listener);

        patchExternalPluginParameterValue('inst-missing', 7, 0.9);
        patchExternalPluginParameterValue('inst-1', 99, 0.9);

        unsubscribe();
        expect(listener).not.toHaveBeenCalled();
        expect(externalPluginParameterStore.value).toBe(before);
    });
});
