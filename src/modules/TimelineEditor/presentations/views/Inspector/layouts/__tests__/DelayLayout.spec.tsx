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

const mockDelayTaps = vi.fn((_props: unknown) => <div data-testid="delay-taps" />);
vi.mock('#/components/daw/visualizers/DelayTaps', () => ({
    DelayTaps: (props: unknown) => mockDelayTaps(props),
}));

const mockSetDeviceParameter = vi.fn();
vi.mock('#/modules/Arrangement/useCases', () => ({
    setDeviceParameter: (...args: unknown[]) => mockSetDeviceParameter(...args),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div data-testid="param-control">{param.id}</div>,
}));

const PARAM_IDS = ['delay-time', 'delay-feedback', 'delay-lowcut', 'delay-highcut', 'delay-mix'];

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
    name: 'Delay',
    type: 'builtin-delay',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('DelayLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../DelayLayout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for builtin-delay', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-delay', expect.any(Function));
    });

    it('buckets parameters into time/feedback, lowcut/highcut, and a trailing mix control, in order', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const ids = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(ids).toEqual(PARAM_IDS);
    });

    it('feeds DelayTaps the live parameter values, defaulting anything unset', () => {
        const device = makeDevice({ parameterValues: { 'delay-time': 500, 'delay-mix': 0.6 } });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        expect(mockDelayTaps).toHaveBeenCalledWith(expect.objectContaining({ time: 500, feedback: 0.4, mix: 0.6 }));
    });

    it('forwards DelayTaps parameter changes to setDeviceParameter scoped to the device', () => {
        const device = makeDevice({ id: 'device-9' });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const { onParamChange } = mockDelayTaps.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        onParamChange('delay-time', 300);

        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-9', 'delay-time', 300);
    });
});
