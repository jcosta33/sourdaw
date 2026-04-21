import { describe, it, expect, vi } from 'vitest';

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
            (params as Array<{ id: string }>).filter((param) => ids.includes(param.id)),
    };
});

vi.mock('#/components/daw/visualizers/CompressorCurve', () => ({
    CompressorCurve: () => <div data-testid="compressor-curve">Compressor Curve</div>,
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

describe('CompressorLayout', () => {
    it('should register layout for compressor variants', async () => {
        await import('../CompressorLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalled();
        const [deviceTypes] = mockRegisterDeviceLayout.mock.calls[0];
        expect(deviceTypes).toContain('builtin-compressor');
        expect(deviceTypes).toContain('builtin-sidechain-compressor');
    });
});
