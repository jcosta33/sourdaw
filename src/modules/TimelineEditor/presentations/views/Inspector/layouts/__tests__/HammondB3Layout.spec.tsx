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

vi.mock('#/components/ui/slider', () => ({
    Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (values: number[]) => void }) => (
        <input
            type="range"
            data-testid="slider"
            value={value[0]}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
    ),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div data-testid="param-control">{param.id}</div>,
}));

const DRAWBAR_IDS = [
    'drawbar_16',
    'drawbar_513',
    'drawbar_8',
    'drawbar_4',
    'drawbar_223',
    'drawbar_2',
    'drawbar_135',
    'drawbar_113',
    'drawbar_1',
];

const makeParam = (id: string): DeviceParameterView => ({
    id,
    deviceId: 'device-1',
    name: id,
    type: 'float',
    value: 8,
    defaultValue: 8,
    minValue: 0,
    maxValue: 8,
    unit: '',
    automatable: true,
    hasAutomation: false,
});

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
    id: 'device-1',
    name: 'Hammond B3',
    type: 'faust-hammond-b3',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('HammondB3Layout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../HammondB3Layout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for faust-hammond-b3', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('faust-hammond-b3', expect.any(Function));
    });

    it('fixes drawbar order regardless of input order, inverts live values, defaults missing ones, and forwards changes back inverted', () => {
        // Shuffled input, drawbar_2 omitted entirely; only two values set to prove both invert + default paths.
        const shuffled = [...DRAWBAR_IDS].filter((id) => id !== 'drawbar_2').reverse();
        const device = makeDevice({ id: 'device-9', parameterValues: { drawbar_16: 3, drawbar_8: 0 } });

        render(<Layout device={device} trackId="track-1" parameters={shuffled.map(makeParam)} />);

        const sliders = screen.getAllByTestId('slider');
        expect(sliders.map((el) => (el as HTMLInputElement).value)).toEqual(['5', '0', '8', '0', '0', '0', '0', '0']);

        fireEvent.change(sliders[0]!, { target: { value: '6' } });
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-9', 'drawbar_16', 2); // 8 - 6
    });

    it('renders a Controls section only when non-drawbar params are present', () => {
        const { unmount } = render(
            <Layout device={makeDevice()} trackId="track-1" parameters={DRAWBAR_IDS.map(makeParam)} />
        );
        expect(screen.queryByText('Controls')).not.toBeInTheDocument();
        unmount();

        const withExtra = [...DRAWBAR_IDS.map(makeParam), makeParam('leslieSpeed')];
        render(<Layout device={makeDevice()} trackId="track-1" parameters={withExtra} />);
        expect(screen.getByText('Controls')).toBeInTheDocument();
        expect(screen.getByTestId('param-control')).toHaveTextContent('leslieSpeed');
    });
});
