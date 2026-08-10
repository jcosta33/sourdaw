import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackDevicesSection } from '../TrackDevicesSection';

import type { Track, Device } from '../../../../models/TrackViewTypes';

type TestPlatformPlugin = {
    id: string;
    name: string;
    category: 'effect' | 'utility' | 'analyzer';
};

type TestPluginDescriptor = {
    hasCustomUI?: boolean;
} | null;

type TestPluginScanViewState = {
    scannedPlugins: Array<{ id: string; name: string; format: string }>;
};

// Mock external dependencies
const mockBypassDevice = vi.fn<(deviceId: string, bypassed: boolean) => void>();
const mockRemoveDevice = vi.fn<(deviceId: string) => void>();
const mockAddDevice = vi.fn<(trackId: string, pluginName: string) => void>();
const mockAddExternalDevice = vi.fn<(trackId: string, pluginId: string, pluginName: string) => void>();
const mockReorderDevices = vi.fn<(trackId: string, fromIndex: number, toIndex: number) => void>();
const mockGetPlatformPlugins = vi.fn<() => TestPlatformPlugin[]>(() => []);
const mockGetPluginById = vi.fn<(id: string) => TestPluginDescriptor>(() => null);
const mockGetPlatformCapabilities = vi.fn(() => ({ hasNativePlugins: false }));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        bypassDevice: (deviceId: string, bypassed: boolean): void => {
            mockBypassDevice(deviceId, bypassed);
        },
        removeDevice: (deviceId: string): void => {
            mockRemoveDevice(deviceId);
        },
        addDevice: (trackId: string, pluginName: string): void => {
            mockAddDevice(trackId, pluginName);
        },
        addExternalDevice: (trackId: string, pluginId: string, pluginName: string): void => {
            mockAddExternalDevice(trackId, pluginId, pluginName);
        },
        reorderDevices: (trackId: string, fromIndex: number, toIndex: number): void => {
            mockReorderDevices(trackId, fromIndex, toIndex);
        },
        getPlatformPlugins: () => mockGetPlatformPlugins(),
        getPluginById: (id: string) => mockGetPluginById(id),
    };
});

const mockOpenPluginGui = vi.fn<(instanceId: string) => Promise<void>>();
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        openPluginGui: (instanceId: string): Promise<void> => mockOpenPluginGui(instanceId),
    };
});

const mockShowDevicePanelForType = vi.fn<(deviceType: string, deviceId: string) => void>();
vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    showDevicePanelForType: (deviceType: string, deviceId: string): void => {
        mockShowDevicePanelForType(deviceType, deviceId);
    },
}));

const mockUseStore = vi.fn((_store: unknown, _defaultState: unknown): TestPluginScanViewState => ({
    scannedPlugins: [],
}));
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => mockUseStore(store, defaultState),
}));

vi.mock('#/modules/PluginHost/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/stores')>();
    return {
        ...actual,
        pluginScanStore: {},
        defaultPluginScanState: { scannedPlugins: [] },
    };
});

vi.mock('#/utils/platformCapabilities', () => ({
    getPlatformCapabilities: () => mockGetPlatformCapabilities(),
    DISABLED_REASONS: { nativePlugins: 'Desktop app required' },
}));

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title }: { title: string }) => <div data-testid="blocked-state">{title}</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
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

vi.mock('../../../components/Inspector/ChoiceCard', () => ({
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
        midiFx: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
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
        mockGetPlatformPlugins.mockReturnValue([]);
        mockGetPluginById.mockReturnValue(null);
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: false });
        mockUseStore.mockReturnValue({ scannedPlugins: [] });
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
        const firstCard = choiceCards[0];
        if (!firstCard) {
            throw new Error('expected a choice card');
        }
        fireEvent.click(firstCard);
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

    it('should add a platform device from the menu and close the menu', () => {
        mockGetPlatformPlugins.mockReturnValue([{ id: 'chorus', name: 'Chorus', category: 'effect' }]);

        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);

        fireEvent.click(screen.getByLabelText('Add device'));

        const chorusMenuItem = screen.getByRole('menuitem', { name: 'Chorus' });
        expect(chorusMenuItem.tagName).toBe('BUTTON');

        fireEvent.click(chorusMenuItem);

        // By id, not by the label on the menu item: `addDevice` matches on name
        // *or* id, and three catalog names are carried by two plugins each.
        expect(mockAddDevice).toHaveBeenCalledWith('track-1', 'chorus');
        expect(screen.queryByRole('menuitem', { name: 'Chorus' })).not.toBeInTheDocument();
    });

    it('offers only supported CLAP plugins from stale scan state', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockUseStore.mockReturnValue({
            scannedPlugins: [
                { id: 'vst-1', name: 'Stale VST', format: 'vst3' },
                { id: 'clap-1', name: 'Working CLAP', format: 'clap' },
                { id: 'au-1', name: 'Stale AU', format: 'au' },
            ],
        });

        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        fireEvent.click(screen.getByLabelText('Add device'));

        expect(screen.queryByRole('menuitem', { name: /Stale VST/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: /Stale AU/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: /Working CLAP/ }));
        expect(mockAddExternalDevice).toHaveBeenCalledWith('track-1', 'clap-1', 'Working CLAP');
    });

    it('should apply opacity to bypassed devices', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const choiceCards = screen.getAllByTestId('choice-card');
        const bypassedCard = choiceCards[1];
        if (!bypassedCard) {
            throw new Error('expected a bypassed choice card');
        }
        expect(bypassedCard.className).toContain('opacity-50');
    });
});
