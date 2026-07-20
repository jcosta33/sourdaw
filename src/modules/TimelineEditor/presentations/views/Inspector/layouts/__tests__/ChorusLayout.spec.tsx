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

const mockModulationLFO = vi.fn((_props: unknown) => <div data-testid="modulation-lfo" />);
vi.mock('../../../../components/ModulationLFO', () => ({
    ModulationLFO: (props: unknown) => mockModulationLFO(props),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div data-testid="param-control">{param.id}</div>,
}));

const PARAM_IDS = ['phaser-rate', 'phaser-depth', 'phaser-feedback', 'phaser-stages'];

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
    name: 'Phaser',
    type: 'builtin-phaser',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('ChorusLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../ChorusLayout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for chorus, phaser, and flanger variants', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith(
            ['builtin-chorus', 'builtin-phaser', 'builtin-flanger'],
            expect.any(Function)
        );
    });

    it('pairs parameters for the grid and renders phaser-stages separately at the end, in order', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        const ids = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(ids).toEqual(PARAM_IDS);
    });

    it('feeds ModulationLFO the live rate/depth, falling back across chorus/phaser/flanger keys', () => {
        const device = makeDevice({ parameterValues: { 'phaser-rate': 0.3, 'phaser-depth': 8 } });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        expect(mockModulationLFO).toHaveBeenCalledWith(
            expect.objectContaining({ rate: 0.3, depth: 8, shape: 'sine', width: 240, height: 50 })
        );
    });

    it('defaults ModulationLFO rate/depth when no matching parameter values are set', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);

        expect(mockModulationLFO).toHaveBeenCalledWith(expect.objectContaining({ rate: 1.5, depth: 5 }));
    });
});
