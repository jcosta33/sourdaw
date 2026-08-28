import { beforeEach, describe, expect, it } from 'vitest';

import {
    defaultExternalPluginParameterState,
    type ExternalPluginParameter,
    externalPluginParameterStore,
} from '#/modules/PluginHost/stores';

import { acceptsExternalPluginAutomationParameter } from '../acceptsExternalPluginAutomationParameter';

function externalParameter(overrides: Partial<ExternalPluginParameter> = {}): ExternalPluginParameter {
    return {
        id: 3,
        name: 'Drive',
        value: 0.4,
        defaultValue: 0.5,
        minValue: -12,
        maxValue: 24,
        unit: 'dB',
        isAutomatable: true,
        ...overrides,
    };
}

function publishSnapshot(instanceId: string, engineAttached: boolean, parameters: ExternalPluginParameter[]): void {
    externalPluginParameterStore.set({ byInstanceId: { [instanceId]: { engineAttached, parameters } } });
}

describe('acceptsExternalPluginAutomationParameter', () => {
    beforeEach(() => {
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
    });

    it('accepts a parameter the instance declares automatable', () => {
        publishSnapshot('inst-1', true, [externalParameter({ id: 3 })]);

        expect(acceptsExternalPluginAutomationParameter('inst-1', '3')).toBe(true);
    });

    it('refuses a parameter the instance declares non-automatable', () => {
        publishSnapshot('inst-1', true, [externalParameter({ id: 3, isAutomatable: false })]);

        expect(acceptsExternalPluginAutomationParameter('inst-1', '3')).toBe(false);
    });

    it('refuses an id the instance never declared', () => {
        publishSnapshot('inst-1', true, [externalParameter({ id: 3 })]);

        expect(acceptsExternalPluginAutomationParameter('inst-1', '4')).toBe(false);
        expect(acceptsExternalPluginAutomationParameter('inst-1', 'cutoff')).toBe(false);
    });

    it('refuses an instance with no published snapshot at all', () => {
        expect(acceptsExternalPluginAutomationParameter('inst-unknown', '3')).toBe(false);
    });

    it('refuses every parameter of an unattached instance', () => {
        publishSnapshot('inst-detached', false, [externalParameter({ id: 3 })]);

        expect(acceptsExternalPluginAutomationParameter('inst-detached', '3')).toBe(false);
    });
});
