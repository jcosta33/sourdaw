import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviceInspector } from '../DeviceInspector';

// Mock external dependencies
vi.mock('../layouts', () => ({})); // Prevent OOM by not loading all layouts

vi.mock('#/modules/Arrangement/useCases/getBuiltinPlugins', () => ({
    getBuiltinPlugins: vi.fn(() => []),
}));

vi.mock('#/modules/Arrangement/useCases/device/bypassDevice', () => ({
    bypassDevice: vi.fn(),
}));

vi.mock('../deviceLayoutRegistry', () => ({
    resolveDeviceLayout: vi.fn(() => null),
    registerDeviceLayout: vi.fn(),
    SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
}));

vi.mock('../../../components/Inspector/MetaText', () => ({
    MetaText: ({ children }: { children: React.ReactNode }) => <span data-testid="meta-text">{children}</span>,
}));

vi.mock('../../../components/Inspector/InspectorDetailHeader', () => ({
    InspectorDetailHeader: ({
        title,
        onBack,
        actions,
    }: any) => (
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
    }: any) => (
        <button
            data-testid="mechanical-switch"
            data-checked={checked}
            onClick={() => onChange(!checked)}
        >
            Toggle
        </button>
    ),
}));

vi.mock('../GenericDeviceLayout', () => ({
    GenericDeviceLayout: () => <div data-testid="generic-layout">Generic Layout</div>,
}));

describe('DeviceInspector', () => {
    const mockDevice = {
        id: 'device-1',
        name: 'Test Device',
        type: 'builtin-synth',
        bypassed: false,
        parameterValues: { gain: 0.5, cutoff: 1000 },
    };

    const mockOnBack = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<DeviceInspector device={mockDevice as any} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByTestId('inspector-header')).toBeInTheDocument();
    });

    it('should display device name in header', () => {
        render(<DeviceInspector device={mockDevice as any} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByText('Test Device')).toBeInTheDocument();
    });

    it('should call onBack when back button is clicked', () => {
        render(<DeviceInspector device={mockDevice as any} trackId="track-1" onBack={mockOnBack} />);
        fireEvent.click(screen.getByTestId('back-btn'));
        expect(mockOnBack).toHaveBeenCalledTimes(1);
    });

    it('should call bypassDevice when toggle is clicked', async () => {
        const { bypassDevice } = await import('#/modules/Arrangement/useCases/device/bypassDevice');
        render(<DeviceInspector device={mockDevice as any} trackId="track-1" onBack={mockOnBack} />);
        fireEvent.click(screen.getByTestId('mechanical-switch'));
        expect(bypassDevice).toHaveBeenCalled();
    });
});
