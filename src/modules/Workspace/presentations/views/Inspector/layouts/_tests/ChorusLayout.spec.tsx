import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('../../../components/ModulationLFO', () => ({
    ModulationLFO: () => <div data-testid="modulation-lfo">Modulation LFO</div>,
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

describe('ChorusLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Chorus',
        type: 'builtin-chorus',
        bypassed: false,
        parameterValues: {
            'chorus-rate': 1.5,
            'chorus-depth': 5,
            'chorus-mix': 0.5,
        },
    };

    const mockParameters = [
        { id: 'chorus-rate', name: 'Rate', type: 'float', value: 1.5, defaultValue: 1.5, minValue: 0, maxValue: 20, unit: 'Hz', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'chorus-depth', name: 'Depth', type: 'float', value: 5, defaultValue: 5, minValue: 0, maxValue: 100, unit: '%', automatable: true, hasAutomation: false, deviceId: 'device-1' },
        { id: 'chorus-mix', name: 'Mix', type: 'float', value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' },
    ];

    const mockProps: DeviceLayoutProps = {
        device: mockDevice,
        trackId: 'track-1',
        parameters: mockParameters,
    };

    it('should register layout for chorus, phaser, and flanger', async () => {
        await import('../ChorusLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalled();
        const [deviceTypes] = mockRegisterDeviceLayout.mock.calls[0];
        expect(deviceTypes).toContain('builtin-chorus');
        expect(deviceTypes).toContain('builtin-phaser');
        expect(deviceTypes).toContain('builtin-flanger');
    });
});
