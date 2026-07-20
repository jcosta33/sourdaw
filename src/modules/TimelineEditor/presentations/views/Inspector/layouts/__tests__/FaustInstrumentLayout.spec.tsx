import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

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

    it('shows Envelope and Oscillator visualizations for a synth device with a waveform param, defaulting their values', () => {
        const device = makeDevice({ type: 'faust-synth-lead' });
        const parameters = [makeParam({ id: 'waveform', name: 'Waveform' })];

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
        const parameters = [makeParam({ id: 'cutoff', name: 'Cutoff' })];

        render(<Layout device={device} trackId="track-1" parameters={parameters} />);

        expect(mockFilterResponse).toHaveBeenCalledWith(expect.objectContaining({ cutoff: 5000, resonance: 1 }));

        const { onParamChange } = mockFilterResponse.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        onParamChange('cutoff', 2200);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-7', 'cutoff', 2200);
    });

    it('shows the Compressor visualization for a compressor-typed device, defaulting its values', () => {
        const device = makeDevice({ type: 'faust-1176-compressor' });
        const parameters = [makeParam({ id: 'ratio', name: 'Ratio' })];

        render(<Layout device={device} trackId="track-1" parameters={parameters} />);

        expect(mockCompressorCurve).toHaveBeenCalledWith(
            expect.objectContaining({ threshold: -20, ratio: 4, knee: 6, makeup: 0 })
        );
    });
});
