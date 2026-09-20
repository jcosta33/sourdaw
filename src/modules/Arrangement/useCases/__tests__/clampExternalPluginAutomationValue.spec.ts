import { beforeEach, describe, expect, it } from 'vitest';

import {
    defaultExternalPluginParameterState,
    type ExternalPluginParameter,
    externalPluginParameterStore,
} from '#/modules/PluginHost/stores';

import { clampExternalPluginAutomationValue } from '../clampExternalPluginAutomationValue';

function externalParameter(overrides: Partial<ExternalPluginParameter> = {}): ExternalPluginParameter {
    return {
        id: 3,
        name: 'Cutoff',
        value: 1_000,
        defaultValue: 1_000,
        minValue: 20,
        maxValue: 20_000,
        unit: 'Hz',
        isAutomatable: true,
        ...overrides,
    };
}

function publishSnapshot(instanceId: string, engineAttached: boolean, parameters: ExternalPluginParameter[]): void {
    externalPluginParameterStore.set({ byInstanceId: { [instanceId]: { engineAttached, parameters } } });
}

function clamp(value: number, parameterId = '3', instanceId = 'inst-1'): number {
    return clampExternalPluginAutomationValue({ externalInstanceId: instanceId, parameterId, value });
}

describe('clampExternalPluginAutomationValue', () => {
    beforeEach(() => {
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
    });

    it('uses captured parameter bounds after the live instance is replaced', () => {
        publishSnapshot('inst-1', true, [externalParameter({ minValue: 10, maxValue: 50 })]);
        const source = structuredClone(externalPluginParameterStore.value);
        publishSnapshot('inst-1', true, [externalParameter({ minValue: 100, maxValue: 500 })]);
        expect(
            clampExternalPluginAutomationValue({ externalInstanceId: 'inst-1', parameterId: '3', value: 1_000 }, source)
        ).toBe(50);
        expect(
            clampExternalPluginAutomationValue({ externalInstanceId: 'inst-1', parameterId: '3', value: 1_000 }, null)
        ).toBe(1_000);
    });

    it('holds a value to the range the instance published', () => {
        publishSnapshot('inst-1', true, [externalParameter()]);

        // What a lane with `linkScale: -1` delivers from a 20..20000 Hz curve:
        // the scale is applied after the lane-range clamp, so the sign flips
        // outside anything the lane declared.
        expect(clamp(-20_000)).toBe(20);
        expect(clamp(1e9)).toBe(20_000);
    });

    it('leaves a value already inside the range untouched', () => {
        publishSnapshot('inst-1', true, [externalParameter()]);

        expect(clamp(1_234.5)).toBe(1_234.5);
        expect(clamp(20)).toBe(20);
        expect(clamp(20_000)).toBe(20_000);
    });

    it('passes the value through for a parameter no snapshot declares', () => {
        publishSnapshot('inst-1', true, [externalParameter()]);

        expect(clamp(1e9, '99')).toBe(1e9);
        expect(clamp(1e9, '3', 'inst-unknown')).toBe(1e9);
    });

    it('passes the value through for an instance that is not attached to the engine', () => {
        publishSnapshot('inst-1', false, [externalParameter()]);

        // Nothing is delivered to an unattached instance anyway; inventing a
        // bound for it would be a clamp the caller could mistake for a gate.
        expect(clamp(1e9)).toBe(1e9);
    });

    it('passes the value through when the plugin declares no usable range', () => {
        publishSnapshot('inst-1', true, [
            externalParameter({ id: 3, minValue: Number.NaN, maxValue: 1 }),
            externalParameter({ id: 4, minValue: 10, maxValue: 5 }),
        ]);

        expect(clamp(1e9, '3')).toBe(1e9);
        expect(clamp(1e9, '4')).toBe(1e9);
    });
});
