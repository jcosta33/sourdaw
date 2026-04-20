import { describe, it, expect, vi } from 'vitest';

import type { DeviceLayoutProps } from '../../deviceLayoutRegistry';

// Mock external dependencies
const mockRegisterDeviceLayout = vi.fn();
vi.mock('../../deviceLayoutRegistry', async () => {
    const actual = await vi.importActual('../../deviceLayoutRegistry');
    return {
        ...(actual as object),
        registerDeviceLayout: (...args: unknown[]) => mockRegisterDeviceLayout(...args),
        SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
        filterParams: (params: unknown[], ids: string[]) =>
            (params as Array<{ id: string }>).filter((p) => ids.includes(p.id)),
    };
});

vi.mock('#/components/daw/visualizers/ReverbDecay', () => ({
    ReverbDecay: () => <div data-testid="reverb-decay">Reverb Decay</div>,
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

describe('ReverbLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Reverb',
        type: 'builtin-reverb',
        bypassed: false,
        parameterValues: {
            'rev-size': 0.5,
            'rev-decay': 2,
            'rev-damping': 0.5,
            'rev-predelay': 10,
            'rev-lowcut': 100,
            'rev-mix': 0.3,
        },
    };

    const mockParameters = [
        {
            id: 'rev-size',
            name: 'Size',
            type: 'float',
            value: 0.5,
            defaultValue: 0.5,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'rev-decay',
            name: 'Decay',
            type: 'float',
            value: 2,
            defaultValue: 2,
            minValue: 0.1,
            maxValue: 10,
            unit: 's',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'rev-damping',
            name: 'Damping',
            type: 'float',
            value: 0.5,
            defaultValue: 0.5,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
            deviceId: 'device-1',
        },
        {
            id: 'rev-mix',
            name: 'Mix',
            type: 'float',
            value: 0.3,
            defaultValue: 0.3,
            minValue: 0,
            maxValue: 1,
            unit: '',
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

    it('should register layout for builtin-reverb', async () => {
        await import('../ReverbLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-reverb', expect.any(Function));
    });
});
