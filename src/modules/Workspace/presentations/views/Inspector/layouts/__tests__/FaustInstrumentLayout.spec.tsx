import { describe, it, expect, vi } from 'vitest';

import type { DeviceLayoutProps } from '../../deviceLayoutRegistry';

// Mock external dependencies
const { mockRegisterPrefixLayout } = vi.hoisted(() => ({
    mockRegisterPrefixLayout: vi.fn(),
}));
vi.mock('../../deviceLayoutRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../deviceLayoutRegistry')>();
    return {
        ...actual,
        registerPrefixLayout: (...args: unknown[]) => mockRegisterPrefixLayout(...args),
        SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
    };
});

vi.mock('#/components/daw/visualizers/ADSREnvelope', () => ({
    ADSREnvelope: () => <div data-testid="adsr-envelope">ADSR Envelope</div>,
}));

vi.mock('#/components/daw/visualizers/FilterResponse', () => ({
    FilterResponse: () => <div data-testid="filter-response">Filter Response</div>,
}));

vi.mock('#/components/daw/visualizers/CompressorCurve', () => ({
    CompressorCurve: () => <div data-testid="compressor-curve">Compressor Curve</div>,
}));

vi.mock('#/components/daw/visualizers/OscillatorWaveform', () => ({
    OscillatorWaveform: () => <div data-testid="oscillator-waveform">Oscillator Waveform</div>,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setDeviceParameter: vi.fn(),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

describe('FaustInstrumentLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Faust Instrument',
        type: 'faust-organ',
        bypassed: false,
        parameterValues: {
            attack: 0.01,
            decay: 0.2,
            sustain: 0.7,
            release: 0.3,
            cutoff: 5000,
            resonance: 1,
        },
    };

    const mockParameters = [
        {
            id: 'attack',
            name: 'Attack',
            type: 'float',
            value: 0.01,
            defaultValue: 0.01,
            minValue: 0.001,
            maxValue: 5,
            unit: 's',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'decay',
            name: 'Decay',
            type: 'float',
            value: 0.2,
            defaultValue: 0.2,
            minValue: 0.001,
            maxValue: 5,
            unit: 's',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'sustain',
            name: 'Sustain',
            type: 'float',
            value: 0.7,
            defaultValue: 0.7,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'cutoff',
            name: 'Cutoff',
            type: 'float',
            value: 5000,
            defaultValue: 5000,
            minValue: 20,
            maxValue: 20000,
            unit: 'Hz',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
    ];

    const mockProps: DeviceLayoutProps = {
        device: mockDevice,
        trackId: 'track-1',
        parameters: mockParameters,
    };

    it('should register layout for faust- prefix', async () => {
        await import('../FaustInstrumentLayout');
        expect(mockRegisterPrefixLayout).toHaveBeenCalledWith('faust-', expect.any(Function));
    });
});
