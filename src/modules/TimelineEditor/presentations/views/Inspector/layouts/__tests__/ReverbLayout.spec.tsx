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

const mockReverbDecay = vi.fn((_props: unknown) => <div data-testid="reverb-decay" />);
vi.mock('#/components/daw/visualizers/ReverbDecay', () => ({
    ReverbDecay: (props: unknown) => mockReverbDecay(props),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div data-testid="param-control">{param.id}</div>,
}));

const PARAM_IDS = ['rev-size', 'rev-decay', 'rev-damping', 'rev-predelay', 'rev-lowcut', 'rev-mix'];

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
    name: 'Reverb',
    type: 'builtin-reverb',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('ReverbLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../ReverbLayout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for builtin-reverb', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-reverb', expect.any(Function));
    });

    it('buckets parameters into size/decay, damping/predelay, and lowcut/mix pairs, in order', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const ids = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(ids).toEqual(PARAM_IDS);
    });

    it('feeds ReverbDecay the live parameter values, defaulting anything unset', () => {
        const device = makeDevice({ parameterValues: { 'rev-size': 0.8, 'rev-predelay': 25 } });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        expect(mockReverbDecay).toHaveBeenCalledWith(
            expect.objectContaining({ size: 0.8, decay: 2, damping: 0.5, predelay: 25 })
        );
    });
});
