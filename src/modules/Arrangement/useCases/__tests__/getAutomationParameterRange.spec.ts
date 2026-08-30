import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultExternalPluginParameterState,
    type ExternalPluginParameter,
    externalPluginParameterStore,
} from '#/modules/PluginHost/stores';

import { BUILTIN_PLUGINS } from '../../models/DeviceParameter';
import { isDeviceParameterAutomatable } from '../../models/DeviceParameterLaw';
import { createTrack } from '../../models/Track';
import { getAutomationParameterRange } from '../getAutomationParameterRange';
import { getTrackById } from '../getTrackById';

vi.mock('../getTrackById', () => ({
    getTrackById: vi.fn(),
}));

describe('getAutomationParameterRange', () => {
    beforeEach(() => {
        vi.mocked(getTrackById).mockReset();
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
    });

    it('returns every automatable built-in parameter range from its owning descriptor', () => {
        const devices = BUILTIN_PLUGINS.map((plugin, index) => ({
            id: `device-${index}`,
            name: plugin.name,
            type: plugin.id,
            bypassed: false,
            parameterValues: {},
        }));
        vi.mocked(getTrackById).mockReturnValue({
            ...createTrack({ id: 'track-1', name: 'Track', kind: 'audio' }),
            devices,
        });

        let compared = 0;
        for (let deviceIndex = 0; deviceIndex < BUILTIN_PLUGINS.length; deviceIndex++) {
            const plugin = BUILTIN_PLUGINS[deviceIndex]!;
            for (const parameter of plugin.parameters) {
                if (!isDeviceParameterAutomatable({ deviceType: plugin.id, paramId: parameter.id })) {
                    continue;
                }
                compared++;
                expect(
                    getAutomationParameterRange({
                        trackId: 'track-1',
                        parameterTargetId: `device-${deviceIndex}:${parameter.id}`,
                    }),
                    `${plugin.id}.${parameter.id}`
                ).toEqual({ minValue: parameter.minValue, maxValue: parameter.maxValue });
            }
        }

        expect(compared).toBeGreaterThan(100);
    });

    it('fails closed when the target cannot identify one automatable device parameter', () => {
        const track = createTrack({ id: 'track-1', name: 'Track', kind: 'audio' });
        vi.mocked(getTrackById).mockReturnValue(track);

        expect(
            getAutomationParameterRange({ trackId: track.id, parameterTargetId: 'device-missing:high_cut' })
        ).toBeNull();
    });

    it('resolves the descriptor range for a persisted legacy device name', () => {
        const track = createTrack({ id: 'track-1', name: 'Track', kind: 'audio' });
        track.devices.push({
            id: 'device-crumbs',
            name: 'Crumbs',
            type: 'cRuMbS',
            bypassed: false,
            parameterValues: { masterGain: 0.8 },
        });
        vi.mocked(getTrackById).mockReturnValue(track);

        expect(
            getAutomationParameterRange({
                trackId: track.id,
                parameterTargetId: 'device-crumbs:masterGain',
            })
        ).toEqual({ minValue: 0, maxValue: 2 });
    });

    describe('external plugin devices', () => {
        const DRIVE: ExternalPluginParameter = {
            id: 3,
            name: 'Drive',
            value: 0.4,
            defaultValue: 0.5,
            minValue: -12,
            maxValue: 24,
            unit: 'dB',
            isAutomatable: true,
        };

        function seedPluginTrack(instanceId = 'inst-1'): void {
            const track = createTrack({ id: 'track-1', name: 'Track', kind: 'audio' });
            track.devices.push({
                id: 'device-plugin',
                name: 'Airwindows Console',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'plugin-a',
                externalInstanceId: instanceId,
            });
            vi.mocked(getTrackById).mockReturnValue(track);
        }

        it("resolves the plugin's own declared range, not a fabricated one", () => {
            seedPluginTrack();
            externalPluginParameterStore.set({
                byInstanceId: { 'inst-1': { engineAttached: true, parameters: [DRIVE] } },
            });

            expect(getAutomationParameterRange({ trackId: 'track-1', parameterTargetId: 'device-plugin:3' })).toEqual({
                minValue: -12,
                maxValue: 24,
            });
        });

        it('refuses a parameter id the instance never declared', () => {
            seedPluginTrack();
            externalPluginParameterStore.set({
                byInstanceId: { 'inst-1': { engineAttached: true, parameters: [DRIVE] } },
            });

            expect(
                getAutomationParameterRange({ trackId: 'track-1', parameterTargetId: 'device-plugin:4' })
            ).toBeNull();
        });

        it('refuses a parameter the instance declares non-automatable', () => {
            seedPluginTrack();
            externalPluginParameterStore.set({
                byInstanceId: {
                    'inst-1': { engineAttached: true, parameters: [{ ...DRIVE, isAutomatable: false }] },
                },
            });

            expect(
                getAutomationParameterRange({ trackId: 'track-1', parameterTargetId: 'device-plugin:3' })
            ).toBeNull();
        });

        it('degrades to no range for an instance loaded without a running native engine', () => {
            seedPluginTrack();
            externalPluginParameterStore.set({
                byInstanceId: { 'inst-1': { engineAttached: false, parameters: [DRIVE] } },
            });

            expect(
                getAutomationParameterRange({ trackId: 'track-1', parameterTargetId: 'device-plugin:3' })
            ).toBeNull();
        });
    });
});
