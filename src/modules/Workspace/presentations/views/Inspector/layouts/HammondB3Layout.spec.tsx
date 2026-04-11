import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DeviceLayoutProps } from '../deviceLayoutRegistry';

// Mock external dependencies
const mockRegisterDeviceLayout = vi.fn();
vi.mock('../deviceLayoutRegistry', async () => {
    const actual = await vi.importActual('../deviceLayoutRegistry');
    return {
        ...(actual as object),
        registerDeviceLayout: (...args: unknown[]) => mockRegisterDeviceLayout(...args),
    };
});

const mockSetDeviceParameter = vi.fn();
vi.mock('#/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter', () => ({
    setDeviceParameter: (...args: unknown[]) => mockSetDeviceParameter(...args),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
    }: {
        value: number[];
        onValueChange: (values: number[]) => void;
    }) => (
        <input
            type="range"
            data-testid="slider"
            value={value[0]}
            onChange={(e) => onValueChange([Number(e.target.value)])}
        />
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="surface-card">{children}</div>
    ),
}));

vi.mock('../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

describe('HammondB3Layout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Hammond B3',
        type: 'faust-hammond-b3',
        bypassed: false,
        parameterValues: {
            drawbar_16: 8,
            drawbar_513: 8,
            drawbar_8: 8,
            drawbar_4: 0,
            drawbar_223: 0,
            drawbar_2: 0,
            drawbar_135: 0,
            drawbar_113: 0,
            drawbar_1: 0,
        },
        parameters: [
            { id: 'drawbar_16', name: '16\' Sub', type: 'int', value: 8, defaultValue: 8, minValue: 0, maxValue: 8, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
            { id: 'drawbar_513', name: '5 1/3\'', type: 'int', value: 8, defaultValue: 8, minValue: 0, maxValue: 8, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
            { id: 'drawbar_8', name: '8\'', type: 'int', value: 8, defaultValue: 8, minValue: 0, maxValue: 8, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        ],
    };

    const mockProps: DeviceLayoutProps = {
        device: mockDevice,
        trackId: 'track-1',
        parameters: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should register layout for faust-hammond-b3', async () => {
        await import('./HammondB3Layout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('faust-hammond-b3', expect.any(Function));
    });
});
