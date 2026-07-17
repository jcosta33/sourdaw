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

vi.mock('../../../../components/ModulationLFO', () => ({
    ModulationLFO: () => <div data-testid="modulation-lfo">Modulation LFO</div>,
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

describe('ChorusLayout', () => {
    it('should register layout for chorus, phaser, and flanger', async () => {
        await import('../ChorusLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalled();
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        const [deviceTypes] = firstCall;
        expect(deviceTypes).toContain('builtin-chorus');
        expect(deviceTypes).toContain('builtin-phaser');
        expect(deviceTypes).toContain('builtin-flanger');
    });
});
