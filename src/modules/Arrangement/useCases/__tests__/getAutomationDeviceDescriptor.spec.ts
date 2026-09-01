import { beforeEach, describe, expect, it } from 'vitest';

import {
    defaultExternalPluginParameterState,
    type ExternalPluginParameter,
    externalPluginParameterStore,
} from '#/modules/PluginHost/stores';

import { BUILTIN_PLUGINS } from '../../models/DeviceParameter';
import { getAutomationDeviceDescriptor } from '../getAutomationDeviceDescriptor';

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

describe('getAutomationDeviceDescriptor', () => {
    beforeEach(() => {
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
    });

    it('resolves a built-in descriptor by id and by legacy display name', () => {
        const descriptor = BUILTIN_PLUGINS[0]!;

        expect(getAutomationDeviceDescriptor(descriptor.id)).toBe(descriptor);
        expect(getAutomationDeviceDescriptor(descriptor.name.toUpperCase())).toBe(descriptor);
    });

    it('projects an attached plugin instance onto the descriptor shape, with the plugin range', () => {
        publishSnapshot('inst-1', true, [externalParameter()]);

        expect(getAutomationDeviceDescriptor('external-plugin', 'inst-1')?.parameters).toEqual([
            {
                // The plugin's own `u32` id, spelled as the target ids carry it.
                id: '3',
                deviceId: 'inst-1',
                name: 'Drive',
                type: 'float',
                value: 0.4,
                defaultValue: 0.5,
                minValue: -12,
                maxValue: 24,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
        ]);
    });

    it('offers nothing for a loaded instance that never attached to the engine', () => {
        publishSnapshot('inst-detached', false, [externalParameter()]);

        expect(getAutomationDeviceDescriptor('external-plugin', 'inst-detached')).toBeUndefined();
    });

    it('offers nothing for an instance that has published no parameters', () => {
        expect(getAutomationDeviceDescriptor('external-plugin', 'inst-unknown')).toBeUndefined();
    });

    it('does not fall back to a built-in descriptor when an instance id is supplied', () => {
        // A device type that resolves perfectly well as a built-in must not
        // answer for a plugin instance: the instance is the identity being
        // asked about, and its snapshot is the only honest source.
        expect(getAutomationDeviceDescriptor(BUILTIN_PLUGINS[0]!.id, 'inst-unknown')).toBeUndefined();
    });
});
