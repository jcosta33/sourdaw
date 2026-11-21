import { describe, expect, it } from 'vitest';

import { modulationDependenciesPort, setModulationDependencies } from '../modulationDependencies';

function updateDeviceParam(): void {}

function getPluginParamRange(): null {
    return null;
}

function quantiseValue(input: { value: number }): number {
    return input.value;
}

function otherQuantiseValue(input: { value: number }): number {
    return Math.round(input.value);
}

describe('modulationDependencies', () => {
    it('throws naming the registrar when read before registration', () => {
        expect(() => modulationDependenciesPort.read()).toThrow(
            'modulationDependenciesPort.read: modulation dependencies are not registered; call setModulationDependencies() from #/app/bootstrap'
        );
    });

    it('returns what was filled', () => {
        setModulationDependencies({ updateDeviceParam, getPluginParamRange, quantiseValue });

        expect(modulationDependenciesPort.read().quantiseValue).toBe(quantiseValue);
    });

    it('replaces the first fill with a second', () => {
        setModulationDependencies({ updateDeviceParam, getPluginParamRange, quantiseValue });
        setModulationDependencies({ updateDeviceParam, getPluginParamRange, quantiseValue: otherQuantiseValue });

        expect(modulationDependenciesPort.read().quantiseValue).toBe(otherQuantiseValue);
    });
});
