import { beforeEach, describe, expect, it } from 'vitest';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
    writeExternalPluginParameterSnapshot,
    type ExternalPluginParameter,
} from '../../../stores/externalPluginParameterStore';
import { markExternalPluginEngineAttached } from '../markExternalPluginEngineAttached';

/**
 * The correction a plugin loaded before the first play gets when the engine
 * finally starts and takes it over. Everything here is about not disturbing what
 * the instance already published: it is the same plugin, still holding the same
 * settings, and only the attachment fact changed.
 */
const DEGRADED_MESSAGE = 'Loaded without a running native engine — this plugin processes no audio yet.';

const PARAMETER: ExternalPluginParameter = {
    id: 7,
    name: 'Drive',
    value: 0.8,
    defaultValue: 0.5,
    minValue: 0,
    maxValue: 1,
    unit: '',
    isAutomatable: true,
};

function seedDormantInstance(instanceId: string): void {
    writeExternalPluginParameterSnapshot(instanceId, { engineAttached: false, parameters: [PARAMETER] });
    externalPluginActivationStore.set({
        byInstanceId: { [instanceId]: { status: 'active', message: DEGRADED_MESSAGE } },
    });
}

describe('markExternalPluginEngineAttached', () => {
    beforeEach(() => {
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
    });

    it('records the attachment and clears the degraded note', () => {
        seedDormantInstance('inst-1');

        markExternalPluginEngineAttached({ instanceId: 'inst-1' });

        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toEqual({
            engineAttached: true,
            // The value the plugin last reported survives: the attach says
            // nothing about the settings, so replacing them would discard a
            // plugin-side edit made while it was dormant.
            parameters: [PARAMETER],
        });
        expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toEqual({ status: 'active' });
    });

    it('is idempotent for an instance that is already attached', () => {
        writeExternalPluginParameterSnapshot('inst-1', { engineAttached: true, parameters: [PARAMETER] });
        externalPluginActivationStore.set({ byInstanceId: { 'inst-1': { status: 'active' } } });
        const parameters = externalPluginParameterStore.value;
        const activation = externalPluginActivationStore.value;

        markExternalPluginEngineAttached({ instanceId: 'inst-1' });

        expect(externalPluginParameterStore.value).toBe(parameters);
        expect(externalPluginActivationStore.value).toBe(activation);
    });

    it('writes nothing for an instance this process never activated', () => {
        markExternalPluginEngineAttached({ instanceId: 'ghost' });

        expect(externalPluginParameterStore.value).toEqual(defaultExternalPluginParameterState);
        expect(externalPluginActivationStore.value).toEqual(defaultExternalPluginActivationState);
    });

    it('leaves an errored activation entry alone', () => {
        writeExternalPluginParameterSnapshot('inst-1', { engineAttached: false, parameters: [PARAMETER] });
        externalPluginActivationStore.set({
            byInstanceId: { 'inst-1': { status: 'error', message: 'the plugin crashed on load' } },
        });

        markExternalPluginEngineAttached({ instanceId: 'inst-1' });

        expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toEqual({
            status: 'error',
            message: 'the plugin crashed on load',
        });
    });
});
