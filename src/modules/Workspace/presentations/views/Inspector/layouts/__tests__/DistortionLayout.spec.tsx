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

vi.mock('#/components/daw/visualizers/DistortionCurve', () => ({
    DistortionCurve: () => <div data-testid="distortion-curve">Distortion Curve</div>,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
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

describe('DistortionLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Distortion',
        type: 'builtin-distortion',
        bypassed: false,
        parameterValues: {
            'dist-drive': 20,
            'dist-tone': 4000,
            'dist-output': 0.8,
            'dist-mix': 0.5,
        },
    };

    const mockParameters = [
        { id: 'dist-drive', name: 'Drive', type: 'float', value: 20, defaultValue: 20, minValue: 0, maxValue: 100, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'dist-tone', name: 'Tone', type: 'float', value: 4000, defaultValue: 4000, minValue: 100, maxValue: 10000, unit: 'Hz', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'dist-output', name: 'Output', type: 'float', value: 0.8, defaultValue: 0.8, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'dist-mix', name: 'Mix', type: 'float', value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
    ];

    const mockProps: DeviceLayoutProps = {
        device: mockDevice,
        trackId: 'track-1',
        parameters: mockParameters,
    };

    it('should register layout for builtin-distortion', async () => {
        await import('../DistortionLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-distortion', expect.any(Function));
    });
});
