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

const mockDistortionCurve = vi.fn((_props: unknown) => <div data-testid="distortion-curve" />);
vi.mock('#/components/daw/visualizers/DistortionCurve', () => ({
    DistortionCurve: (props: unknown) => mockDistortionCurve(props),
}));

const { mockChange, mockStart, mockSettle, mockCancel } = vi.hoisted(() => ({
    mockChange: vi.fn(),
    mockStart: vi.fn(() => 7),
    mockSettle: vi.fn(),
    mockCancel: vi.fn(),
}));
vi.mock('../../../../hooks/useDeviceParameterGesture', () => ({
    useDeviceParameterGesture: ({ param, device }: { param: DeviceParameterView; device: Device }) => ({
        value: device.parameterValues[param.id] ?? param.value,
        previewValue: 45,
        startGesture: mockStart,
        isGestureCurrent: (token: number) => token === 7,
        change: mockChange,
        settleGesture: mockSettle,
        cancel: mockCancel,
    }),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param, previewValue }: { param: { id: string }; previewValue?: number }) => (
        <div data-testid="param-control" data-preview={previewValue}>
            {param.id}
        </div>
    ),
}));

const PARAM_IDS = ['dist-drive', 'dist-tone', 'dist-output', 'dist-mix'];

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
    name: 'Distortion',
    type: 'builtin-distortion',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('DistortionLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../DistortionLayout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for builtin-distortion', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-distortion', expect.any(Function));
    });

    it('buckets parameters into drive/tone and output/mix pairs, in order', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const ids = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(ids).toEqual(PARAM_IDS);
    });

    it('feeds DistortionCurve the live parameter values, defaulting anything unset', () => {
        const device = makeDevice({ parameterValues: { 'dist-drive': 60, 'dist-mix': 0.8 } });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        expect(mockDistortionCurve).toHaveBeenCalledWith(expect.objectContaining({ drive: 60, tone: 4000, mix: 0.8 }));
    });

    it('wires the curve and Drive preview to the shared gesture boundary', () => {
        const device = makeDevice({ id: 'device-9' });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const { onParamChange, onGestureStart, isGestureCurrent, onGestureCommit, onGestureCancel } =
            mockDistortionCurve.mock.calls.at(-1)![0] as {
                onParamChange: (id: string, value: number) => void;
                onGestureStart: () => number;
                isGestureCurrent: (token: number) => boolean;
                onGestureCommit: () => void;
                onGestureCancel: () => void;
            };
        expect(onGestureStart()).toBe(7);
        expect(isGestureCurrent(7)).toBe(true);
        expect(isGestureCurrent(8)).toBe(false);
        onParamChange('dist-drive', 45);
        onGestureCommit();
        onGestureCancel();

        expect(mockStart).toHaveBeenCalledOnce();
        expect(mockChange).toHaveBeenCalledWith(45, true);
        expect(mockSettle).toHaveBeenCalledOnce();
        expect(mockCancel).toHaveBeenCalledOnce();
        expect(screen.getAllByTestId('param-control')[0]).toHaveAttribute('data-preview', '45');
        expect(screen.getAllByTestId('param-control')[1]).not.toHaveAttribute('data-preview');
    });
});
