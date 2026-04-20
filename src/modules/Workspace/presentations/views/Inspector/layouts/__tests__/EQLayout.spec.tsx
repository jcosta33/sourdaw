import { describe, it, expect, vi } from 'vitest';

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
        SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
        filterParams: (params: unknown[], ids: string[]) =>
            (params as Array<{ id: string }>).filter((p) => ids.includes(p.id)),
    };
});

vi.mock('#/components/daw/visualizers/EQCurve', () => ({
    EQCurve: () => <div data-testid="eq-curve">EQ Curve</div>,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setDeviceParameter: vi.fn(),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

describe('EQLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'EQ',
        type: 'builtin-eq',
        bypassed: false,
        parameterValues: {
            'eq-low-gain': 0,
            'eq-low-freq': 100,
            'eq-low-q': 1,
            'eq-mid-gain': 0,
            'eq-mid-freq': 1000,
            'eq-mid-q': 1,
            'eq-high-gain': 0,
            'eq-high-freq': 8000,
            'eq-high-q': 1,
        },
    };

    const mockParameters = [
        {
            id: 'eq-low-gain',
            name: 'Low Gain',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: -12,
            maxValue: 12,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'eq-low-freq',
            name: 'Low Freq',
            type: 'float',
            value: 100,
            defaultValue: 100,
            minValue: 20,
            maxValue: 500,
            unit: 'Hz',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'eq-mid-gain',
            name: 'Mid Gain',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: -12,
            maxValue: 12,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'eq-high-gain',
            name: 'High Gain',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: -12,
            maxValue: 12,
            unit: 'dB',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
    ];

    const mockProps: DeviceLayoutProps = {
        device: mockDevice,
        trackId: 'track-1',
        parameters: mockParameters,
    };

    it('should register layout for builtin-eq', async () => {
        await import('../EQLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-eq', expect.any(Function));
    });
});
