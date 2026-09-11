import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

import type { DeviceParameterView } from '../../../../../models/PluginDescriptorViewTypes';
import type { Device } from '../../../../../models/TrackViewTypes';
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
    };
});

const mockSetDeviceParameter = vi.fn();
vi.mock('#/modules/Arrangement/useCases', () => ({
    setDeviceParameter: (...args: unknown[]) => mockSetDeviceParameter(...args),
}));

const mockADSREnvelope = vi.fn((_props: unknown) => <div data-testid="adsr-envelope" />);
vi.mock('#/components/daw/visualizers/ADSREnvelope', () => ({
    ADSREnvelope: (props: unknown) => mockADSREnvelope(props),
}));

const mockFilterResponse = vi.fn((_props: unknown) => <div data-testid="filter-response" />);
vi.mock('#/components/daw/visualizers/FilterResponse', () => ({
    FilterResponse: (props: unknown) => mockFilterResponse(props),
}));

const mockCompressorCurve = vi.fn((_props: unknown) => <div data-testid="compressor-curve" />);
vi.mock('#/components/daw/visualizers/CompressorCurve', () => ({
    CompressorCurve: (props: unknown) => mockCompressorCurve(props),
}));

const mockOscillatorWaveform = vi.fn((_props: unknown) => <div data-testid="oscillator-waveform" />);
vi.mock('#/components/daw/visualizers/OscillatorWaveform', () => ({
    OscillatorWaveform: (props: unknown) => mockOscillatorWaveform(props),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div data-testid="param-control">{param.id}</div>,
}));

const makeParam = (overrides: Partial<DeviceParameterView> & { id: string; name: string }): DeviceParameterView => ({
    deviceId: 'device-1',
    type: 'float',
    value: 0,
    defaultValue: 0,
    minValue: 0,
    maxValue: 1,
    unit: '',
    automatable: true,
    hasAutomation: false,
    ...overrides,
});

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
    id: 'device-1',
    name: 'Faust Instrument',
    type: 'faust-generic',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('FaustInstrumentLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../FaustInstrumentLayout');
        const firstCall = mockRegisterPrefixLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerPrefixLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    beforeEach(() => {
        mockSetDeviceParameter.mockClear();
        mockADSREnvelope.mockClear();
        mockFilterResponse.mockClear();
        mockCompressorCurve.mockClear();
        mockOscillatorWaveform.mockClear();
    });

    it('registers the layout for the faust- prefix', () => {
        expect(mockRegisterPrefixLayout).toHaveBeenCalledWith('faust-', expect.any(Function));
    });

    it('shows a loading message and renders nothing else when there are no parameters yet', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={[]} />);

        expect(screen.getByText(/this instrument is loading/i)).toBeInTheDocument();
        expect(screen.queryAllByTestId('param-control')).toHaveLength(0);
        expect(mockADSREnvelope).not.toHaveBeenCalled();
    });

    it('buckets params into categories by name, first-match-wins, with leftovers in Other', () => {
        const parameters = [
            makeParam({ id: 'p1', name: 'Brightness' }), // Tone
            makeParam({ id: 'p2', name: 'Attack Time' }), // Envelope
            makeParam({ id: 'p3', name: 'Decay Time' }), // Envelope (also matches Resonance, but Envelope wins)
            makeParam({ id: 'p4', name: 'Output Level' }), // Output
            makeParam({ id: 'p5', name: 'Vibrato Rate' }), // Modulation
            makeParam({ id: 'p6', name: 'Reverb Amount' }), // Resonance
            makeParam({ id: 'p7', name: 'Drawbar One' }), // Drawbars
            makeParam({ id: 'p8', name: 'Drive Amount' }), // Character
            makeParam({ id: 'p9', name: 'Mystery Knob' }), // Other
        ];

        render(<Layout device={makeDevice()} trackId="track-1" parameters={parameters} />);

        const ids = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    });

    it('shows no visualizations when nothing matches, while still rendering the categorized param', () => {
        const parameters = [makeParam({ id: 'p1', name: 'Brightness' })];

        render(<Layout device={makeDevice()} trackId="track-1" parameters={parameters} />);

        expect(mockADSREnvelope).not.toHaveBeenCalled();
        expect(mockFilterResponse).not.toHaveBeenCalled();
        expect(mockCompressorCurve).not.toHaveBeenCalled();
        expect(mockOscillatorWaveform).not.toHaveBeenCalled();
        expect(screen.getByTestId('param-control')).toHaveTextContent('p1');
    });

    it('shows Envelope and Oscillator visualizations for a synth device with envelope and waveform params, defaulting their values', () => {
        const device = makeDevice({ type: 'faust-synth-lead' });
        const parameters = [
            makeParam({ id: 'waveform', name: 'Waveform' }),
            makeParam({ id: 'attack', name: 'Attack', defaultValue: 0.01 }),
            makeParam({ id: 'decay', name: 'Decay', defaultValue: 0.2 }),
            makeParam({ id: 'sustain', name: 'Sustain', defaultValue: 0.7 }),
            makeParam({ id: 'release', name: 'Release', defaultValue: 0.3 }),
        ];

        render(<Layout device={device} trackId="track-1" parameters={parameters} />);

        expect(mockADSREnvelope).toHaveBeenCalledWith(
            expect.objectContaining({ attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 })
        );
        expect(mockOscillatorWaveform).toHaveBeenCalledWith(expect.objectContaining({ osc2Mix: 0, detune: 0 }));
        expect(mockFilterResponse).not.toHaveBeenCalled();
        expect(mockCompressorCurve).not.toHaveBeenCalled();
    });

    it('shows the Filter visualization when a cutoff-like param id is present, and forwards its changes', () => {
        const device = makeDevice({ id: 'device-7' });
        const parameters = [makeParam({ id: 'cutoff', name: 'Cutoff', defaultValue: 5000 })];

        render(<Layout device={device} trackId="track-1" parameters={parameters} />);

        expect(mockFilterResponse).toHaveBeenCalledWith(expect.objectContaining({ cutoff: 5000, resonance: 1 }));

        const { onParamChange } = mockFilterResponse.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        onParamChange('cutoff', 2200);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-7', 'cutoff', 2200);
    });

    it('shows the Compressor visualization for a compressor-typed device with threshold and ratio, defaulting their values', () => {
        const device = makeDevice({ type: 'faust-1176-compressor' });
        const parameters = [
            makeParam({ id: 'threshold', name: 'Threshold', defaultValue: -20 }),
            makeParam({ id: 'ratio', name: 'Ratio', defaultValue: 4 }),
        ];

        render(<Layout device={device} trackId="track-1" parameters={parameters} />);

        expect(mockCompressorCurve).toHaveBeenCalledWith(
            expect.objectContaining({ threshold: -20, ratio: 4, knee: 6, makeup: 0 })
        );
    });

    const fmSynthParams: DeviceParameterView[] = [
        makeParam({ id: 'algorithm', name: 'Algorithm', defaultValue: 0 }),
        makeParam({ id: 'op1_ratio', name: 'OP1 Ratio', defaultValue: 1 }),
        makeParam({ id: 'op1_level', name: 'OP1 Level', defaultValue: 1 }),
        makeParam({ id: 'op1_attack', name: 'OP1 Attack', defaultValue: 0.01 }),
        makeParam({ id: 'op1_decay', name: 'OP1 Decay', defaultValue: 0.1 }),
        makeParam({ id: 'op1_sustain', name: 'OP1 Sustain', defaultValue: 0.8 }),
        makeParam({ id: 'op1_release', name: 'OP1 Release', defaultValue: 0.5 }),
        makeParam({ id: 'op2_ratio', name: 'OP2 Ratio', defaultValue: 2 }),
        makeParam({ id: 'op2_level', name: 'OP2 Level', defaultValue: 0.5 }),
        makeParam({ id: 'op2_attack', name: 'OP2 Attack', defaultValue: 0.01 }),
        makeParam({ id: 'op2_decay', name: 'OP2 Decay', defaultValue: 0.1 }),
        makeParam({ id: 'op2_sustain', name: 'OP2 Sustain', defaultValue: 0.8 }),
        makeParam({ id: 'op2_release', name: 'OP2 Release', defaultValue: 0.5 }),
        makeParam({ id: 'op3_ratio', name: 'OP3 Ratio', defaultValue: 3 }),
        makeParam({ id: 'op3_level', name: 'OP3 Level', defaultValue: 0.5 }),
        makeParam({ id: 'op3_attack', name: 'OP3 Attack', defaultValue: 0.01 }),
        makeParam({ id: 'op3_decay', name: 'OP3 Decay', defaultValue: 0.1 }),
        makeParam({ id: 'op3_sustain', name: 'OP3 Sustain', defaultValue: 0.8 }),
        makeParam({ id: 'op3_release', name: 'OP3 Release', defaultValue: 0.5 }),
        makeParam({ id: 'op4_ratio', name: 'OP4 Ratio', defaultValue: 4 }),
        makeParam({ id: 'op4_level', name: 'OP4 Level', defaultValue: 0.5 }),
        makeParam({ id: 'op4_attack', name: 'OP4 Attack', defaultValue: 0.01 }),
        makeParam({ id: 'op4_decay', name: 'OP4 Decay', defaultValue: 0.1 }),
        makeParam({ id: 'op4_sustain', name: 'OP4 Sustain', defaultValue: 0.8 }),
        makeParam({ id: 'op4_release', name: 'OP4 Release', defaultValue: 0.5 }),
        makeParam({ id: 'gain', name: 'Gain', defaultValue: 0.5 }),
        makeParam({ id: 'freq', name: 'Freq', defaultValue: 440 }),
        makeParam({ id: 'gate', name: 'Gate', defaultValue: 0 }),
    ];

    const supersawParams: DeviceParameterView[] = [
        makeParam({ id: 'lfo_rate', name: 'LFO Rate', defaultValue: 5 }),
        makeParam({ id: 'lfo_depth', name: 'LFO Depth', defaultValue: 0 }),
        makeParam({ id: 'detune', name: 'Detune', defaultValue: 15 }),
        makeParam({ id: 'center_mix', name: 'Center Mix', defaultValue: 0.7 }),
        makeParam({ id: 'cutoff', name: 'Cutoff', defaultValue: 6000 }),
        makeParam({ id: 'resonance', name: 'Resonance', defaultValue: 0.3 }),
        makeParam({ id: 'attack', name: 'Attack', defaultValue: 0.01 }),
        makeParam({ id: 'decay', name: 'Decay', defaultValue: 0.3 }),
        makeParam({ id: 'sustain', name: 'Sustain', defaultValue: 0.8 }),
        makeParam({ id: 'release', name: 'Release', defaultValue: 0.5 }),
        makeParam({ id: 'freq', name: 'Freq', defaultValue: 440 }),
        makeParam({ id: 'gate', name: 'Gate', defaultValue: 0 }),
    ];

    const rhodesParams: DeviceParameterView[] = [
        makeParam({ id: 'brightness', name: 'Brightness', defaultValue: 0.5 }),
        makeParam({ id: 'body_decay', name: 'Body Decay', defaultValue: 1.5 }),
        makeParam({ id: 'bell_decay', name: 'Bell Decay', defaultValue: 0.15 }),
        makeParam({ id: 'gain', name: 'Gain', defaultValue: 0.5 }),
        makeParam({ id: 'freq', name: 'Freq', defaultValue: 440 }),
        makeParam({ id: 'gate', name: 'Gate', defaultValue: 0 }),
    ];

    it('for faust-fm-synth, admits neither Filter nor generic Envelope graph, and never writes undeclared parameters', () => {
        const device = makeDevice({ id: 'fm-dev', type: 'faust-fm-synth' });
        render(<Layout device={device} trackId="track-1" parameters={fmSynthParams} />);

        expect(mockFilterResponse).not.toHaveBeenCalled();
        expect(mockADSREnvelope).not.toHaveBeenCalled();
        expect(screen.getByText('op1_attack')).toBeInTheDocument();
        expect(mockSetDeviceParameter).not.toHaveBeenCalled();
    });

    it('for faust-supersaw-unison, binds Filter and Envelope graphs to declared parameter IDs cutoff, resonance, and attack/decay/sustain/release', () => {
        const device = makeDevice({ id: 'saw-dev', type: 'faust-supersaw-unison' });
        render(<Layout device={device} trackId="track-1" parameters={supersawParams} />);

        expect(mockFilterResponse).toHaveBeenCalledWith(expect.objectContaining({ cutoff: 6000, resonance: 0.3 }));

        const { onParamChange: onFilterChange } = mockFilterResponse.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        onFilterChange('filterCutoff', 2500);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('saw-dev', 'cutoff', 2500);

        onFilterChange('filterResonance', 0.8);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('saw-dev', 'resonance', 0.8);

        const { onParamChange: onEnvChange } = mockADSREnvelope.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        onEnvChange('attack', 0.05);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('saw-dev', 'attack', 0.05);

        onEnvChange('decay', 0.4);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('saw-dev', 'decay', 0.4);

        onEnvChange('sustain', 0.6);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('saw-dev', 'sustain', 0.6);

        onEnvChange('release', 0.9);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('saw-dev', 'release', 0.9);

        const declaredParamIds = new Set(supersawParams.map((p) => p.id));
        for (const call of mockSetDeviceParameter.mock.calls) {
            const paramId = call[1] as string;
            expect(declaredParamIds.has(paramId)).toBe(true);
        }
        const passedParamIds = mockSetDeviceParameter.mock.calls.map((c) => c[1]);
        expect(passedParamIds).not.toContain('filterCutoff');
        expect(passedParamIds).not.toContain('filterResonance');
    });

    it('for faust-rhodes, admits neither Filter nor Envelope graph', () => {
        const device = makeDevice({ id: 'rhodes-dev', type: 'faust-rhodes' });
        render(<Layout device={device} trackId="track-1" parameters={rhodesParams} />);

        expect(mockFilterResponse).not.toHaveBeenCalled();
        expect(mockADSREnvelope).not.toHaveBeenCalled();
    });

    it('for compressor device, maps comp-threshold from visualizer to declared threshold param', () => {
        const deviceId = 'comp-dev';
        const device = makeDevice({ id: deviceId, type: 'faust-1176-compressor' });
        const compParams = [
            makeParam({ id: 'threshold', name: 'Threshold', defaultValue: -20 }),
            makeParam({ id: 'ratio', name: 'Ratio', defaultValue: 4 }),
            makeParam({ id: 'attack', name: 'Attack', defaultValue: 0.001 }),
            makeParam({ id: 'release', name: 'Release', defaultValue: 0.1 }),
        ];

        render(<Layout device={device} trackId="track-1" parameters={compParams} />);

        expect(mockCompressorCurve).toHaveBeenCalled();
        const { onParamChange: onCompChange } = mockCompressorCurve.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        onCompChange('comp-threshold', -18);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith(deviceId, 'threshold', -18);
    });
});
