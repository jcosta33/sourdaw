import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import type { DeviceParameterView } from '../../../../../models/PluginDescriptorViewTypes';
import type { Device } from '../../../../../models/TrackViewTypes';
import type { DeviceLayoutProps } from '../../deviceLayoutRegistry';

// Mock external dependencies
const { mockRegisterDeviceLayout } = vi.hoisted(() => ({
    mockRegisterDeviceLayout: vi.fn(),
}));
vi.mock('../../deviceLayoutRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../deviceLayoutRegistry')>();
    return {
        ...actual,
        registerDeviceLayout: (...args: unknown[]) => mockRegisterDeviceLayout(...args),
    };
});

const mockSetDeviceParameter = vi.fn();
vi.mock('#/modules/Arrangement/useCases', () => ({
    setDeviceParameter: (...args: unknown[]) => mockSetDeviceParameter(...args),
}));

const mockOscillatorWaveform = vi.fn((_props: unknown) => <div data-testid="oscillator-waveform" />);
vi.mock('#/components/daw/visualizers/OscillatorWaveform', () => ({
    OscillatorWaveform: (props: unknown) => mockOscillatorWaveform(props),
}));

const mockFilterResponse = vi.fn((_props: unknown) => <div data-testid="filter-response" />);
vi.mock('#/components/daw/visualizers/FilterResponse', () => ({
    FilterResponse: (props: unknown) => mockFilterResponse(props),
}));

const mockADSREnvelope = vi.fn((_props: unknown) => <div data-testid="adsr-envelope" />);
vi.mock('#/components/daw/visualizers/ADSREnvelope', () => ({
    ADSREnvelope: (props: unknown) => mockADSREnvelope(props),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div data-testid="param-control">{param.id}</div>,
}));

const PARAM_IDS = [
    'waveform',
    'detune',
    'filterCutoff',
    'filterResonance',
    'attack',
    'decay',
    'sustain',
    'release',
    'gain',
    'osc2Waveform',
    'osc2Detune',
    'osc2Mix',
    'stereoSpread',
    'subOscLevel',
    'noiseLevel',
    'filterType',
    'filterEnvAmount',
    'filterVelocitySensitivity',
    'vibratoRate',
    'vibratoDepth',
    'vibratoDelay',
];

const makeParam = (id: string): DeviceParameterView => ({
    id,
    deviceId: 'device-1',
    name: id,
    type: 'float',
    value: 0,
    defaultValue: 0,
    minValue: 0,
    maxValue: 1,
    unit: '',
    automatable: true,
    hasAutomation: false,
});

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
    id: 'device-1',
    name: 'Synth',
    type: 'builtin-synth',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

const PARAMETERS = PARAM_IDS.map(makeParam);

describe('BuiltinSynthLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../BuiltinSynthLayout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for every builtin-synth variant', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith(
            [
                'builtin-synth',
                'builtin-synth-mellotron',
                'builtin-synth-strings',
                'builtin-synth-808bass',
                'builtin-synth-brass',
            ],
            expect.any(Function)
        );
    });

    it('renders primary params in order and keeps advanced sections collapsed by default', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAMETERS} />);

        const visibleIds = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(visibleIds).toEqual([
            'waveform',
            'detune',
            'filterCutoff',
            'filterResonance',
            'attack',
            'decay',
            'sustain',
            'release',
            'gain',
        ]);
    });

    it('derives oscillator waveforms from rounded parameter indices, falling back to sawtooth out of range', () => {
        const device = makeDevice({ parameterValues: { waveform: 0, osc2Waveform: 99 } });
        render(<Layout device={device} trackId="track-1" parameters={PARAMETERS} />);

        expect(mockOscillatorWaveform).toHaveBeenCalledWith(
            expect.objectContaining({ waveform: 'sine', osc2Waveform: 'sawtooth' })
        );
    });

    it('defaults both oscillator waveforms to sawtooth when no parameter values are set', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAMETERS} />);

        expect(mockOscillatorWaveform).toHaveBeenCalledWith(
            expect.objectContaining({ waveform: 'sawtooth', osc2Waveform: 'sawtooth' })
        );
    });

    it('forwards FilterResponse and ADSREnvelope param changes to setDeviceParameter scoped to the device', () => {
        const device = makeDevice({ id: 'device-9' });
        render(<Layout device={device} trackId="track-1" parameters={PARAMETERS} />);

        const { onParamChange: filterChange } = mockFilterResponse.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        filterChange('filterCutoff', 1200);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-9', 'filterCutoff', 1200);

        const { onParamChange: envChange } = mockADSREnvelope.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        envChange('attack', 0.5);
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-9', 'attack', 0.5);
    });

    it('expands the Oscillator 2 collapsible on click, revealing its params, and collapses again on a second click', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAMETERS} />);

        expect(screen.queryByText('osc2Waveform')).not.toBeInTheDocument();

        const toggle = screen.getByRole('button', { name: /oscillator 2/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const openIds = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(openIds).toEqual(expect.arrayContaining(['osc2Waveform', 'osc2Detune', 'osc2Mix', 'stereoSpread']));

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('osc2Waveform')).not.toBeInTheDocument();
    });

    it('expands Filter Advanced to reveal filterType ahead of the env-amount/velocity pair, in order', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAMETERS} />);

        fireEvent.click(screen.getByRole('button', { name: /filter advanced/i }));

        const openIds = screen.getAllByTestId('param-control').map((el) => el.textContent);
        const filterTypeIndex = openIds.indexOf('filterType');
        const envAmountIndex = openIds.indexOf('filterEnvAmount');
        expect(filterTypeIndex).toBeGreaterThan(-1);
        expect(filterTypeIndex).toBeLessThan(envAmountIndex);
    });
});
