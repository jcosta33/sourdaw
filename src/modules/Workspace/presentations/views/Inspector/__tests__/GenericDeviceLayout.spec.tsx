import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { GenericDeviceLayout } from '../GenericDeviceLayout';

import type { DeviceLayoutProps } from '../deviceLayoutRegistry';

// Mock external dependencies
vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({
        title,
        children,
        compact,
    }: {
        title?: string;
        children?: React.ReactNode;
        compact?: boolean;
    }) => (
        <div data-testid="header-band" data-compact={compact}>
            {title ? <span>{title}</span> : null}
            {children}
        </div>
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div data-testid="surface-card" className={className}>
            {children}
        </div>
    ),
}));

vi.mock('../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string; name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('GenericDeviceLayout', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Test Device',
        type: 'effect',
        bypassed: false,
        parameterValues: {},
    };

    const createMockProps = (paramCount: number): DeviceLayoutProps => {
        const parameters = Array.from({ length: paramCount }, (_, i) => ({
            id: `param-${i}`,
            deviceId: 'device-1',
            name: `Parameter ${i}`,
            type: 'float' as const,
            value: 0.5,
            defaultValue: 0.5,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        }));
        return { device: mockDevice, trackId: 'track-1', parameters };
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const props = createMockProps(3);
        renderWithTooltip(<GenericDeviceLayout {...props} />);
        expect(screen.getByTestId('header-band')).toBeInTheDocument();
    });

    it('should render flat grid for 10 or fewer parameters', () => {
        const props = createMockProps(5);
        renderWithTooltip(<GenericDeviceLayout {...props} />);
        const paramControls = screen.getAllByTestId('param-control');
        expect(paramControls.length).toBe(5);
    });

    it('should render collapsible sections for more than 10 parameters', () => {
        const props = createMockProps(15);
        renderWithTooltip(<GenericDeviceLayout {...props} />);
        expect(screen.getByText('Advanced')).toBeInTheDocument();
    });

    it('should group primary parameters into Main section', () => {
        const props: DeviceLayoutProps = {
            device: mockDevice,
            trackId: 'track-1',
            parameters: [
                {
                    id: 'gain',
                    deviceId: 'device-1',
                    name: 'Gain',
                    type: 'float',
                    value: 0.5,
                    defaultValue: 0.5,
                    minValue: 0,
                    maxValue: 1,
                    unit: '',
                    automatable: true,
                    hasAutomation: false,
                },
                {
                    id: 'mix',
                    deviceId: 'device-1',
                    name: 'Mix',
                    type: 'float',
                    value: 0.5,
                    defaultValue: 0.5,
                    minValue: 0,
                    maxValue: 1,
                    unit: '',
                    automatable: true,
                    hasAutomation: false,
                },
                ...Array.from({ length: 9 }, (_, i) => ({
                    id: `dummy-${i}`,
                    deviceId: 'device-1',
                    name: `Dummy ${i}`,
                    type: 'float' as const,
                    value: 0.5,
                    defaultValue: 0.5,
                    minValue: 0,
                    maxValue: 1,
                    unit: '',
                    automatable: true,
                    hasAutomation: false,
                })),
            ],
        };
        renderWithTooltip(<GenericDeviceLayout {...props} />);
        expect(screen.getByText('Main')).toBeInTheDocument();
    });

    it('should group filter parameters into Filter section', () => {
        const props: DeviceLayoutProps = {
            device: mockDevice,
            trackId: 'track-1',
            parameters: [
                {
                    id: 'filterCutoff',
                    deviceId: 'device-1',
                    name: 'Cutoff',
                    type: 'float',
                    value: 1000,
                    defaultValue: 1000,
                    minValue: 20,
                    maxValue: 20000,
                    unit: 'Hz',
                    automatable: true,
                    hasAutomation: false,
                },
                {
                    id: 'filterResonance',
                    deviceId: 'device-1',
                    name: 'Resonance',
                    type: 'float',
                    value: 1,
                    defaultValue: 1,
                    minValue: 0.1,
                    maxValue: 20,
                    unit: '',
                    automatable: true,
                    hasAutomation: false,
                },
                ...Array.from({ length: 9 }, (_, i) => ({
                    id: `dummy-${i}`,
                    deviceId: 'device-1',
                    name: `Dummy ${i}`,
                    type: 'float' as const,
                    value: 0.5,
                    defaultValue: 0.5,
                    minValue: 0,
                    maxValue: 1,
                    unit: '',
                    automatable: true,
                    hasAutomation: false,
                })),
            ],
        };
        renderWithTooltip(<GenericDeviceLayout {...props} />);
        expect(screen.getByText('Filter')).toBeInTheDocument();
    });

    it('should toggle section collapse on click', () => {
        const props = createMockProps(15);
        renderWithTooltip(<GenericDeviceLayout {...props} />);
        const sectionButton = screen.getByText('Advanced').closest('button');
        if (sectionButton) {
            fireEvent.click(sectionButton);
        }
    });

    it('should render parameters in SurfaceCards', () => {
        const props = createMockProps(3);
        renderWithTooltip(<GenericDeviceLayout {...props} />);
        const surfaceCards = screen.getAllByTestId('surface-card');
        expect(surfaceCards.length).toBe(3);
    });
});
