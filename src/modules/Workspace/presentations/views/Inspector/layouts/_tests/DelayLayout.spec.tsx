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

vi.mock('#/components/daw/visualizers/DelayTaps', () => ({
    DelayTaps: () => <div data-testid="delay-taps">Delay Taps</div>,
}));

vi.mock('#/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter', () => ({
    setDeviceParameter: vi.fn(),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="surface-card">{children}</div>
    ),
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

describe('DelayLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Delay',
        type: 'builtin-delay',
        bypassed: false,
        parameterValues: {
            'delay-time': 250,
            'delay-feedback': 0.4,
            'delay-mix': 0.3,
            'delay-lowcut': 100,
            'delay-highcut': 8000,
        },
    };

    const mockParameters = [
        { id: 'delay-time', name: 'Time', type: 'float', value: 250, defaultValue: 250, minValue: 1, maxValue: 5000, unit: 'ms', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'delay-feedback', name: 'Feedback', type: 'float', value: 0.4, defaultValue: 0.4, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'delay-mix', name: 'Mix', type: 'float', value: 0.3, defaultValue: 0.3, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
    ];

    const mockProps: DeviceLayoutProps = {
        device: mockDevice,
        trackId: 'track-1',
        parameters: mockParameters,
    };

    it('should register layout for builtin-delay', async () => {
        await import('../DelayLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-delay', expect.any(Function));
    });
});
