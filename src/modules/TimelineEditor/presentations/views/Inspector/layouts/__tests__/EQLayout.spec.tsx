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

const mockEQCurve = vi.fn((_props: unknown) => <div data-testid="eq-curve" />);
vi.mock('#/components/daw/visualizers/EQCurve', () => ({
    EQCurve: (props: unknown) => mockEQCurve(props),
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

const PARAM_IDS = [
    'eq-low-gain',
    'eq-low-freq',
    'eq-low-q',
    'eq-mid-gain',
    'eq-mid-freq',
    'eq-mid-q',
    'eq-high-gain',
    'eq-high-freq',
    'eq-high-q',
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
    name: 'EQ',
    type: 'builtin-eq',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('EQLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../EQLayout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for builtin-eq', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-eq', expect.any(Function));
    });

    it('buckets low/mid/high band parameters into gain+freq pairs followed by a Q control, in order', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const ids = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(ids).toEqual(PARAM_IDS);
    });

    it('feeds EQCurve the live band values, defaulting anything unset', () => {
        const device = makeDevice({
            parameterValues: { 'eq-low-gain': 3, 'eq-mid-freq': 1200, 'eq-high-q': 2 },
        });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        expect(mockEQCurve).toHaveBeenCalledWith(
            expect.objectContaining({
                lowGain: 3,
                lowFreq: 100,
                lowQ: 1,
                midGain: 0,
                midFreq: 1200,
                midQ: 1,
                highGain: 0,
                highFreq: 8000,
                highQ: 2,
            })
        );
    });

    it('forwards EQCurve parameter changes to setDeviceParameter scoped to the device', () => {
        const device = makeDevice({ id: 'device-9' });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const { onParamChange } = mockEQCurve.mock.calls.at(-1)![0] as {
            onParamChange: (id: string, value: number) => void;
        };
        onParamChange('eq-mid-gain', -4);

        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-9', 'eq-mid-gain', -4);
    });
});
