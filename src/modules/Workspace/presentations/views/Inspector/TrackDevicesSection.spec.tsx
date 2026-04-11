import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackDevicesSection } from './TrackDevicesSection';
import type { Track, Device } from '../../../models/TrackViewTypes';

// Mock external dependencies
const mockBypassDevice = vi.fn();
vi.mock('#/modules/Arrangement/useCases/device/bypassDevice', () => ({
    bypassDevice: (...args: unknown[]) => mockBypassDevice(...args),
}));

const mockRemoveDevice = vi.fn();
vi.mock('#/modules/Arrangement/useCases/device/removeDevice', () => ({
    removeDevice: (...args: unknown[]) => mockRemoveDevice(...args),
}));

const mockAddDevice = vi.fn();
vi.mock('#/modules/Arrangement/useCases/device/addDevice', () => ({
    addDevice: (...args: unknown[]) => mockAddDevice(...args),
}));

const mockAddExternalDevice = vi.fn();
vi.mock('#/modules/Arrangement/useCases/device/addExternalDevice', () => ({
    addExternalDevice: (...args: unknown[]) => mockAddExternalDevice(...args),
}));

const mockReorderDevices = vi.fn();
vi.mock('#/modules/Arrangement/useCases/device/reorderDevices', () => ({
    reorderDevices: (...args: unknown[]) => mockReorderDevices(...args),
}));

const mockGetPlatformPlugins = vi.fn(() => []);
vi.mock('#/modules/Arrangement/useCases/getPlatformPlugins', () => ({
    getPlatformPlugins: () => mockGetPlatformPlugins(),
}));

const mockGetPluginById = vi.fn(() => null);
vi.mock('#/modules/Arrangement/useCases/getPluginById', () => ({
    getPluginById: (id: string) => mockGetPluginById(id),
}));

const mockOpenPluginGui = vi.fn();
vi.mock('#/modules/Plugin/useCases/pluginLifecycle/openPluginGui', () => ({
    openPluginGui: (...args: unknown[]) => mockOpenPluginGui(...args),
}));

const mockShowDevicePanelForType = vi.fn();
vi.mock('#/modules/Workspace/useCases/panels/devicePanels/showDevicePanelForType', () => ({
    showDevicePanelForType: (...args: unknown[]) => mockShowDevicePanelForType(...args),
}));

const mockUseStore = vi.fn(() => ({ scannedPlugins: [] }));
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => mockUseStore(store, defaultState),
}));

vi.mock('#/modules/Plugin/stores/pluginScanStore', () => ({
    pluginScanStore: {},
    defaultPluginScanState: { scannedPlugins: [] },
}));

vi.mock('#/helpers/platformCapabilities', () => ({
    getPlatformCapabilities: () => ({ hasNativePlugins: false }),
    DISABLED_REASONS: { nativePlugins: 'Desktop app required' },
}));

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title }: { title: string }) => <div data-testid="blocked-state">{title}</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({
        title,
        actions,
    }: {
        title?: string;
        actions?: React.ReactNode;
    }) => (
        <div data-testid="header-band">
            <span>{title}</span>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuSectionLabel: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="menu-label">{children}</div>
    ),
    DawMenuDisabledRow: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="menu-disabled-row">{children}</div>
    ),
    DawMenuSeparator: () => <hr data-testid="menu-separator" />,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: (e?: React.MouseEvent) => void;
        'aria-label'?: string;
    }) => (
        <button data-testid="button" aria-label={ariaLabel} onClick={onClick}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/Inspector/ChoiceCard', () => ({
    ChoiceCard: ({
        children,
        onClick,
        className,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        className?: string;
    }) => (
        <div data-testid="choice-card" className={className} onClick={onClick}>
            {children}
        </div>
    ),
}));

describe('TrackDevicesSection', () => {
    const mockOnSelectDevice = vi.fn();

    const mockDevices: Device[] = [
        { id: 'device-1', name: 'Compressor', type: 'builtin-compressor', bypassed: false, parameterValues: {} },
        { id: 'device-2', name: 'EQ', type: 'builtin-eq', bypassed: true, parameterValues: {} },
    ];

    const mockTrack: Track = {
        id: 'track-1',
        name: 'Test Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: mockDevices,
        sends: [],
        frozen: false,
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 100,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        expect(screen.getByText('Devices')).toBeInTheDocument();
    });

    it('should show blocked state when no devices exist', () => {
        const trackNoDevices = { ...mockTrack, devices: [] };
        render(<TrackDevicesSection track={trackNoDevices} onSelectDevice={mockOnSelectDevice} />);
        expect(screen.getByText(/Nothing in the oven yet/i)).toBeInTheDocument();
    });

    it('should render all devices', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        expect(screen.getByText('Compressor')).toBeInTheDocument();
        expect(screen.getByText('EQ')).toBeInTheDocument();
    });

    it('should call onSelectDevice when device is clicked', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const choiceCards = screen.getAllByTestId('choice-card');
        fireEvent.click(choiceCards[0]);
        expect(mockOnSelectDevice).toHaveBeenCalledWith('device-1');
    });

    it('should render bypass button for each device', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const bypassButtons = screen.getAllByLabelText(/Enable|Bypass/i);
        expect(bypassButtons.length).toBe(2);
    });

    it('should render remove button for each device', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const removeButtons = screen.getAllByLabelText(/Remove/i);
        expect(removeButtons.length).toBe(2);
    });

    it('should call bypassDevice when bypass button is clicked', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const bypassButton = screen.getByLabelText('Bypass Compressor');
        fireEvent.click(bypassButton);
        expect(mockBypassDevice).toHaveBeenCalledWith('device-1', true);
    });

    it('should call removeDevice when remove button is clicked', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const removeButton = screen.getByLabelText('Remove Compressor');
        fireEvent.click(removeButton);
        expect(mockRemoveDevice).toHaveBeenCalledWith('device-1');
    });

    it('should apply opacity to bypassed devices', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const choiceCards = screen.getAllByTestId('choice-card');
        expect(choiceCards[1].className).toContain('opacity-50');
    });
});
