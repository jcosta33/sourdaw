import { render, screen } from '@testing-library/react';
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

const mockCompressorCurve = vi.fn((_props: unknown) => <div data-testid="compressor-curve" />);
vi.mock('#/components/daw/visualizers/CompressorCurve', () => ({
    CompressorCurve: (props: unknown) => mockCompressorCurve(props),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div data-testid="param-control">{param.id}</div>,
}));

const PARAM_IDS = ['comp-threshold', 'comp-ratio', 'comp-attack', 'comp-release', 'comp-knee', 'comp-makeup'];

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
    name: 'Compressor',
    type: 'builtin-compressor',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('CompressorLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../CompressorLayout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for both compressor variants', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith(
            ['builtin-compressor', 'builtin-sidechain-compressor'],
            expect.any(Function)
        );
    });

    it('buckets parameters into threshold/ratio, attack/release, and knee/makeup pairs in order', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const ids = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(ids).toEqual(PARAM_IDS);
    });

    it('feeds CompressorCurve the live parameter values, defaulting anything unset', () => {
        const device = makeDevice({ parameterValues: { 'comp-threshold': -12, 'comp-knee': 3 } });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        expect(mockCompressorCurve).toHaveBeenCalledWith(
            expect.objectContaining({ threshold: -12, ratio: 4, knee: 3, makeup: 0 })
        );
    });

    it('forwards CompressorCurve parameter changes to setDeviceParameter scoped to the device', () => {
        const device = makeDevice({ id: 'device-9' });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const { onParamChange } = mockCompressorCurve.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        onParamChange('comp-ratio', 8);

        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-9', 'comp-ratio', 8);
    });
});
