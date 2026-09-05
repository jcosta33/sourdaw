/**
 * The composition root's only route to the device-parameter law the audio
 * engine enforces.
 *
 * The engine cannot import Arrangement's law — that edge closes a module cycle
 * — so every function it applies to a device write arrives through this call.
 * A half-wired seam is therefore silent rather than loud: the offline render
 * and the native live producer both read "unset" as "refuse device
 * automation", so a function that never reaches the state does not throw, it
 * quietly removes a plugin's automation from the bounce and from the engine.
 * These pin that each one arrives, by calling what landed.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { offlineDeviceParameterLawState } from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { configureOfflineDeviceParameterLaw } from '../configureOfflineDeviceParameterLaw';

const cleared = {
    isAutomatable: null,
    clampValue: null,
    quantiseValue: null,
    acceptsExternalPluginParameter: null,
    clampExternalPluginValue: null,
};

afterEach(() => {
    Object.assign(offlineDeviceParameterLawState, cleared);
});

describe('configureOfflineDeviceParameterLaw', () => {
    it('hands the built-in descriptor half to the state the engine reads', () => {
        configureOfflineDeviceParameterLaw({
            isAutomatable: ({ paramId }) => paramId === 'drive',
            clampValue: ({ value }) => Math.min(value, 1),
            quantiseValue: ({ value }) => Math.round(value),
            acceptsExternalPluginParameter: () => false,
            clampExternalPluginValue: ({ value }) => value,
        });

        expect(offlineDeviceParameterLawState.isAutomatable?.({ deviceType: 'crust', paramId: 'drive' })).toBe(true);
        expect(offlineDeviceParameterLawState.clampValue?.({ deviceType: 'crust', paramId: 'drive', value: 4 })).toBe(
            1
        );
        expect(
            offlineDeviceParameterLawState.quantiseValue?.({ deviceType: 'crust', paramId: 'drive', value: 1.6 })
        ).toBe(2);
    });

    it('hands the hosted-instance half to the state the native producer reads', () => {
        configureOfflineDeviceParameterLaw({
            isAutomatable: () => false,
            clampValue: ({ value }) => value,
            quantiseValue: ({ value }) => value,
            acceptsExternalPluginParameter: (externalInstanceId, parameterId) =>
                externalInstanceId === 'instance-1' && parameterId === '7',
            clampExternalPluginValue: ({ value }) => Math.max(value, 0.25),
        });

        expect(offlineDeviceParameterLawState.acceptsExternalPluginParameter?.('instance-1', '7')).toBe(true);
        expect(offlineDeviceParameterLawState.acceptsExternalPluginParameter?.('instance-2', '7')).toBe(false);
        expect(
            offlineDeviceParameterLawState.clampExternalPluginValue?.({
                externalInstanceId: 'instance-1',
                parameterId: '7',
                value: 0,
            })
        ).toBe(0.25);
    });
});
