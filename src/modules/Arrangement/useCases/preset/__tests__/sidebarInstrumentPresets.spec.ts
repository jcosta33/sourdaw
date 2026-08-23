import { describe, expect, it } from 'vitest';

import { getDeviceContractVersionForCommand } from '../../getDeviceContractVersionForCommand';
import { materializePresetDevices } from '../materializePresetDevices';
import { SIDEBAR_INSTRUMENT_PRESETS } from '../sidebarInstrumentPresets';

describe('sidebarInstrumentPresets', () => {
    it('materializes the shipped Sampler preset as the versioned Crumbs device', () => {
        const preset = SIDEBAR_INSTRUMENT_PRESETS.find(({ id }) => id === 'sampler-default');
        const device = preset ? materializePresetDevices(preset)?.[0] : undefined;

        expect({
            deviceType: device?.type,
            contractVersion: device ? getDeviceContractVersionForCommand(device.type) : undefined,
        }).toEqual({
            deviceType: 'builtin-crumbs',
            contractVersion: expect.stringMatching(/^descriptor-v1:[0-9a-f]{8}$/),
        });
    });
});
