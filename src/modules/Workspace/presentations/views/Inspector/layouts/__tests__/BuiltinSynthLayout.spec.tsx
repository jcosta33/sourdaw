import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DeviceLayoutProps } from '../../deviceLayoutRegistry';

// Import after mocking
vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({
        title,
        compact,
    }: {
        title?: string;
        compact?: boolean;
    }) => (
        <div data-testid="header-band" data-compact={compact}>
            {title}
        </div>
    ),
}));

vi.mock('#/components/daw/visualizers/ADSREnvelope', () => ({
    ADSREnvelope: () => <div data-testid="adsr-envelope">ADSR Envelope</div>,
}));

vi.mock('#/components/daw/visualizers/OscillatorWaveform', () => ({
    OscillatorWaveform: () => <div data-testid="oscillator-waveform">Oscillator Waveform</div>,
}));

vi.mock('#/components/daw/visualizers/FilterResponse', () => ({
    FilterResponse: () => <div data-testid="filter-response">Filter Response</div>,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setDeviceParameter: vi.fn(),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="surface-card">{children}</div>
    ),
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

// Mock the registry functions
const { mockRegisterDeviceLayout } = vi.hoisted(() => ({
    mockRegisterDeviceLayout: vi.fn(),
}));
vi.mock('../../deviceLayoutRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../deviceLayoutRegistry')>();
    return {
        ...actual,
        registerDeviceLayout: (...args: unknown[]) => mockRegisterDeviceLayout(...args),
        SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
        filterParams: (params: unknown[], ids: string[]) =>
            (params as Array<{ id: string }>).filter((p) => ids.includes(p.id)),
    };
});

// Import the component after mocks
describe('BuiltinSynthLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Test Synth',
        type: 'builtin-synth',
        bypassed: false,
        parameterValues: {
            waveform: 2,
            osc2Waveform: 2,
            osc2Mix: 0.3,
            osc2Detune: 5,
            filterCutoff: 5000,
            filterResonance: 1,
            filterType: 0,
            attack: 0.01,
            decay: 0.2,
            sustain: 0.7,
            release: 0.3,
            gain: 0.8,
        },
    };

    const mockParameters = [
        { id: 'waveform', name: 'Waveform', type: 'choice', value: 2, defaultValue: 2, minValue: 0, maxValue: 3, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1', choices: ['Sine', 'Triangle', 'Sawtooth', 'Square'] },
        { id: 'osc2Waveform', name: 'Osc 2 Waveform', type: 'choice', value: 2, defaultValue: 2, minValue: 0, maxValue: 3, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'filterCutoff', name: 'Cutoff', type: 'float', value: 5000, defaultValue: 5000, minValue: 20, maxValue: 20000, unit: 'Hz', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'attack', name: 'Attack', type: 'float', value: 0.01, defaultValue: 0.01, minValue: 0.001, maxValue: 5, unit: 's', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'gain', name: 'Gain', type: 'float', value: 0.8, defaultValue: 0.8, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
    ];

    const mockProps: DeviceLayoutProps = {
        device: mockDevice,
        trackId: 'track-1',
        parameters: mockParameters,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should register layout for builtin-synth variants', async () => {
        await import('../BuiltinSynthLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalled();
        const [deviceTypes] = mockRegisterDeviceLayout.mock.calls[0];
        expect(deviceTypes).toContain('builtin-synth');
        expect(deviceTypes).toContain('builtin-synth-mellotron');
    });
});
