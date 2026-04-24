import { describe, it, expect, vi } from 'vitest';

// Mock external dependencies
const mockRegisterDeviceLayout = vi.fn();
vi.mock('../../deviceLayoutRegistry', async () => {
    const actual = await vi.importActual('../../deviceLayoutRegistry');
    return {
        ...(actual as object),
        registerDeviceLayout: (...args: unknown[]) => mockRegisterDeviceLayout(...args),
        SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
        filterParams: (params: unknown[], ids: string[]) =>
            (params as Array<{ id: string }>).filter((param) => ids.includes(param.id)),
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
    it('should register layout for builtin-reverb', async () => {
        await import('../ReverbLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith('builtin-reverb', expect.any(Function));
    });
});
