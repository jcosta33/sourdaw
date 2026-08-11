import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
