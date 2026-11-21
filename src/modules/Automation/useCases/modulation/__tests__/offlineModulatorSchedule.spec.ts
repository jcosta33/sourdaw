import { describe, expect, it } from 'vitest';

import { buildOfflineModulatorPlans } from '../offlineModulatorSchedule';

describe('buildOfflineModulatorPlans', () => {
    it('throws the port error naming its registrar when modulation dependencies are not registered', () => {
        const modulator = {
            id: 'lfo-1',
            name: 'LFO',
            trackId: 'track-1',
            kind: 'lfo' as const,
            config: { kind: 'lfo' as const, waveform: 'sine' as const, rate: 4, sync: true, phase: 0, depth: 1 },
            mappings: [{ targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'cutoff', amount: 0.5 }],
            enabled: true,
        };
        const tracks = [
            {
                id: 'track-1',
                devices: [{ id: 'device-1', type: 'builtin-filter', parameterValues: { cutoff: 500 } }],
            },
        ];

        expect(() => buildOfflineModulatorPlans({ tracks, modulators: [modulator] })).toThrow(
            'modulationDependenciesPort.read: modulation dependencies are not registered; call setModulationDependencies()'
        );
    });
});
