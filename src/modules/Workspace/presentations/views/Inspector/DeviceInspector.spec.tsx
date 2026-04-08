import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviceInspector } from './DeviceInspector';
import type { Device } from '../../../models/TrackViewTypes';

// Mock external dependencies
const mockGetBuiltinPlugins = vi.fn(() => []);
vi.mock('#/modules/Arrangement/useCases/getBuiltinPlugins', () => ({
    getBuiltinPlugins: () => mockGetBuiltinPlugins(),
}));

const mockBypassDevice = vi.fn();
vi.mock('#/modules/Arrangement/useCases/device/bypassDevice', () => ({
    bypassDevice: (...args: unknown[]) => mockBypassDevice(...args),
}));

const mockResolveDeviceLayout = vi.fn(() => null);
vi.mock('./deviceLayoutRegistry', () => ({
    resolveDeviceLayout: (type: string) => mockResolveDeviceLayout(type),
    SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
}));

vi.mock('../../components/Inspector/MetaText', () => ({
    MetaText: ({ children }: { children: React.ReactNode }) => <span data-testid="meta-text">{children}</span>,
}));

vi.mock('../../components/Inspector/InspectorDetailHeader', () => ({
    InspectorDetailHeader: ({
        title,
        onBack,
        actions,
    }: {
        title: React.ReactNode;
        onBack: () => void;
        actions?: React.ReactNode;
    }) => (
        <div data-testid="inspector-header">
            <div data-testid="header-title">{title}</div>
            <button data-testid="back-btn" onClick={onBack}>
                Back
            </button>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/MechanicalSwitch', () => ({
    MechanicalSwitch: ({
        checked,
        onChange,
    }: {
        checked: boolean;
        onChange: (checked: boolean) => void;
    }) => (
        <button
            data-testid="mechanical-switch"
            data-checked={checked}
            onClick={() => onChange(!checked)}
        >
            Toggle
        </button>
    ),
}));

vi.mock('./GenericDeviceLayout', () => ({
    GenericDeviceLayout: () => <div data-testid="generic-layout">Generic Layout</div>,
}));

describe('DeviceInspector', () => {
    const mockDevice: Device = {
        id: 'device-1',
        name: 'Test Device',
        type: 'builtin-synth',
        bypassed: false,
        parameterValues: { gain: 0.5, cutoff: 1000 },
    };

    const mockOnBack = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetBuiltinPlugins.mockReturnValue([]);
        mockResolveDeviceLayout.mockReturnValue(null);
    });

    it('should render without crashing', () => {
        render(<DeviceInspector device={mockDevice} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByTestId('inspector-header')).toBeInTheDocument();
    });

    it('should display device name in header', () => {
        render(<DeviceInspector device={mockDevice} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByText('Test Device')).toBeInTheDocument();
    });

    it('should call onBack when back button is clicked', () => {
        render(<DeviceInspector device={mockDevice} trackId="track-1" onBack={mockOnBack} />);
        fireEvent.click(screen.getByTestId('back-btn'));
        expect(mockOnBack).toHaveBeenCalledTimes(1);
    });

    it('should render mechanical switch for bypass control', () => {
        render(<DeviceInspector device={mockDevice} trackId="track-1" onBack={mockOnBack} />);
        const switchBtn = screen.getByTestId('mechanical-switch');
        expect(switchBtn).toBeInTheDocument();
        expect(switchBtn).toHaveAttribute('data-checked', 'true');
    });

    it('should show bypassed state when device is bypassed', () => {
        const bypassedDevice = { ...mockDevice, bypassed: true };
        render(<DeviceInspector device={bypassedDevice} trackId="track-1" onBack={mockOnBack} />);
        const switchBtn = screen.getByTestId('mechanical-switch');
        expect(switchBtn).toHaveAttribute('data-checked', 'false');
    });

    it('should call bypassDevice when toggle is clicked', () => {
        render(<DeviceInspector device={mockDevice} trackId="track-1" onBack={mockOnBack} />);
        fireEvent.click(screen.getByTestId('mechanical-switch'));
        expect(mockBypassDevice).toHaveBeenCalledWith('device-1', true);
    });

    it('should render generic layout when no specific layout is registered and parameters exist', () => {
        mockGetBuiltinPlugins.mockReturnValue([
            {
                id: 'builtin-synth',
                name: 'Builtin Synth',
                parameters: [{ id: 'gain', name: 'Gain', type: 'float', value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, unit: '', automatable: true, hasAutomation: false, deviceId: 'device-1' }],
            },
        ]);
        render(<DeviceInspector device={mockDevice} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByTestId('generic-layout')).toBeInTheDocument();
    });

    it('should show "no parameters" message when device has no parameters', () => {
        const deviceNoParams = { ...mockDevice, parameterValues: {} };
        render(<DeviceInspector device={deviceNoParams} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByText(/No parameters available/i)).toBeInTheDocument();
    });
});
