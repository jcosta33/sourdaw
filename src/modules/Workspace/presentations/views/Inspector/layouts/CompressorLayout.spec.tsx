import { describe, it, expect, vi } from 'vitest';
import type { DeviceLayoutProps } from '../deviceLayoutRegistry';

// Mock external dependencies
const mockRegisterDeviceLayout = vi.fn();
vi.mock('../deviceLayoutRegistry', async () => {
    const actual = await vi.importActual('../deviceLayoutRegistry');
    return {
        ...(actual as object),
        registerDeviceLayout: (...args: unknown[]) => mockRegisterDeviceLayout(...args),
        SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
        filterParams: (params: unknown[], ids: string[]) =>
            (params as Array<{ id: string }>).filter((p) => ids.includes(p.id)),
    };
});

vi.mock('#/components/daw/visualizers/CompressorCurve', () => ({
    CompressorCurve: () => <div data-testid="compressor-curve">Compressor Curve</div>,
}));

vi.mock('#/modules/Arrangement/useCases/device/setDeviceParameter', () => ({
    setDeviceParameter: vi.fn(),
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

describe('CompressorLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Compressor',
        type: 'builtin-compressor',
        bypassed: false,
        parameterValues: {
            'comp-threshold': -20,
            'comp-ratio': 4,
            'comp-knee': 6,
            'comp-makeup': 0,
            'comp-attack': 0.01,
            'comp-release': 0.1,
        },
    };

    const mockParameters = [
        { id: 'comp-threshold', name: 'Threshold', type: 'float', value: -20, defaultValue: -20, minValue: -60, maxValue: 0, unit: 'dB', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'comp-ratio', name: 'Ratio', type: 'float', value: 4, defaultValue: 4, minValue: 1, maxValue: 20, unit: ':1', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'comp-attack', name: 'Attack', type: 'float', value: 0.01, defaultValue: 0.01, minValue: 0.001, maxValue: 1, unit: 's', automatable: true, hasAutomation: false, deviceId: 'device-1' },
    ];

    const mockProps: DeviceLayoutProps = {
        device: mockDevice,
        trackId: 'track-1',
        parameters: mockParameters,
    };

    it('should register layout for compressor variants', async () => {
        await import('./CompressorLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalled();
        const [deviceTypes] = mockRegisterDeviceLayout.mock.calls[0];
        expect(deviceTypes).toContain('builtin-compressor');
        expect(deviceTypes).toContain('builtin-sidechain-compressor');
    });
});
