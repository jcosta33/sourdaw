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
    scannedPlugins: Array<{ id: string; name: string; format: string; clap_id?: string }>;
};

type TestActivationState = {
    byInstanceId: Record<string, { status: 'loading' | 'active' | 'error'; message?: string }>;
};

// Mock external dependencies
const mockBypassDevice = vi.fn<(deviceId: string, bypassed: boolean) => void>();
const mockRemoveDevice = vi.fn<(deviceId: string) => void>();
const mockAddDevice = vi.fn<(trackId: string, pluginName: string) => void>();
const mockAddExternalDevice = vi.fn<(trackId: string, pluginId: string, pluginName: string) => void>();
const mockReorderDevices = vi.fn<(trackId: string, fromIndex: number, toIndex: number) => void>();
const mockProjectTrackToLiveStrip =
    vi.fn<(input: { trackId: string; activateDormantExternalPlugins: boolean }) => void>();
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
        projectTrackToLiveStrip: (input: { trackId: string; activateDormantExternalPlugins: boolean }): void => {
            mockProjectTrackToLiveStrip(input);
        },
        getPlatformPlugins: () => mockGetPlatformPlugins(),
        getPluginById: (id: string) => mockGetPluginById(id),
    };
});

const mockExecuteAppAction = vi.fn<(action: unknown) => void>();

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: (action: unknown): void => {
        mockExecuteAppAction(action);
    },
}));

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

const mockStores = vi.hoisted(() => ({ scan: {}, activation: {} }));
const mockScanState = vi.fn<() => TestPluginScanViewState>(() => ({
    scannedPlugins: [],
}));
const mockActivationState = vi.fn<() => TestActivationState>(() => ({ byInstanceId: {} }));
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown) => (store === mockStores.activation ? mockActivationState() : mockScanState()),
}));

vi.mock('#/modules/PluginHost/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/stores')>();
    return {
        ...actual,
        pluginScanStore: mockStores.scan,
        defaultPluginScanState: { scannedPlugins: [] },
        externalPluginActivationStore: mockStores.activation,
        defaultExternalPluginActivationState: { byInstanceId: {} },
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
        disabled,
        'aria-label': ariaLabel,
        'aria-pressed': ariaPressed,
    }: {
        children: React.ReactNode;
        onClick?: (e?: React.MouseEvent) => void;
        disabled?: boolean;
        'aria-label'?: string;
        'aria-pressed'?: boolean;
    }) => (
        <button
            data-testid="button"
            aria-label={ariaLabel}
            aria-pressed={ariaPressed}
            onClick={onClick}
            disabled={disabled}
        >
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
        title,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        className?: string;
        title?: string;
    }) => (
        <div data-testid="choice-card" className={className} title={title} onClick={onClick}>
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
        mockScanState.mockReturnValue({ scannedPlugins: [] });
        mockActivationState.mockReturnValue({ byInstanceId: {} });
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

        // The menu routes through the action boundary so the add is one
        // Automerge transaction (undoable), by plugin id — not the label.
        expect(mockExecuteAppAction).toHaveBeenCalledWith({
            type: 'addDevice',
            payload: { trackId: 'track-1', deviceType: 'chorus' },
        });
        expect(mockAddDevice).not.toHaveBeenCalled();
        expect(screen.queryByRole('menuitem', { name: 'Chorus' })).not.toBeInTheDocument();
    });

    it('offers only supported CLAP plugins from stale scan state', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
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

    it('marks a persisted external plugin unavailable when it is absent from the supported scan', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'other-clap', name: 'Other CLAP', format: 'clap' }],
        });
        const trackWithMissingPlugin: Track = {
            ...mockTrack,
            devices: [
                {
                    id: 'legacy-vst-slot',
                    name: 'Legacy VST',
                    type: 'external-plugin',
                    bypassed: false,
                    parameterValues: {},
                    externalPluginId: 'missing-vst',
                    externalInstanceId: 'legacy-instance',
                },
            ],
        };

        render(<TrackDevicesSection track={trackWithMissingPlugin} onSelectDevice={mockOnSelectDevice} />);

        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        const powerButton = screen.getByLabelText('Legacy VST unavailable');
        expect(powerButton).toBeDisabled();
        expect(powerButton).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByLabelText('Open editor for Legacy VST')).not.toBeInTheDocument();
    });

    it('keeps a persisted CLAP slot available when it uses the stable descriptor id', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [
                {
                    id: 'path-hash',
                    clap_id: 'com.vendor.persisted-clap',
                    name: 'Persisted CLAP',
                    format: 'clap',
                },
            ],
        });
        const trackWithPersistedClap: Track = {
            ...mockTrack,
            devices: [
                {
                    id: 'persisted-clap-slot',
                    name: 'Persisted CLAP',
                    type: 'external-plugin',
                    bypassed: false,
                    parameterValues: {},
                    externalPluginId: 'com.vendor.persisted-clap',
                    externalInstanceId: 'persisted-instance',
                },
            ],
        };

        render(<TrackDevicesSection track={trackWithPersistedClap} onSelectDevice={mockOnSelectDevice} />);

        expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Bypass Persisted CLAP')).toBeEnabled();
        expect(screen.getByLabelText('Open editor for Persisted CLAP')).toBeInTheDocument();
    });

    it('surfaces activation failure and retries without changing project state', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'path-hash', name: 'Broken CLAP', format: 'clap' }],
        });
        mockActivationState.mockReturnValue({
            byInstanceId: { 'broken-instance': { status: 'error', message: 'Native activation failed' } },
        });
        const trackWithFailedClap: Track = {
            ...mockTrack,
            devices: [
                {
                    id: 'broken-clap-slot',
                    name: 'Broken CLAP',
                    type: 'external-plugin',
                    bypassed: false,
                    parameterValues: {},
                    externalPluginId: 'path-hash',
                    externalInstanceId: 'broken-instance',
                },
            ],
        };

        render(<TrackDevicesSection track={trackWithFailedClap} onSelectDevice={mockOnSelectDevice} />);

        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Retry Broken CLAP'));
        expect(mockProjectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 'track-1',
            activateDormantExternalPlugins: true,
        });
        expect(mockBypassDevice).not.toHaveBeenCalled();
    });

    it('surfaces a degraded plugin that activated without a running native engine', () => {
        // Activation records the degradation on an 'active' entry, and the rack
        // discriminates on 'error' alone — so a plugin that loaded but
        // processes no audio used to render as a healthy one.
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'path-hash', name: 'Dormant CLAP', format: 'clap' }],
        });
        mockActivationState.mockReturnValue({
            byInstanceId: {
                'dormant-instance': {
                    status: 'active',
                    message: 'Loaded without a running native engine — this plugin processes no audio yet.',
                },
            },
        });
        const trackWithDormantClap: Track = {
            ...mockTrack,
            devices: [
                {
                    id: 'dormant-clap-slot',
                    name: 'Dormant CLAP',
                    type: 'external-plugin',
                    bypassed: false,
                    parameterValues: {},
                    externalPluginId: 'path-hash',
                    externalInstanceId: 'dormant-instance',
                },
            ],
        };

        render(<TrackDevicesSection track={trackWithDormantClap} onSelectDevice={mockOnSelectDevice} />);

        const card = screen.getByTestId('choice-card');
        expect(card).toHaveAttribute(
            'title',
            'Loaded without a running native engine — this plugin processes no audio yet.'
        );
        // Still not 'unavailable': it loaded, and the retry path is for failures.
        expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    });

    it('leaves a healthy device without a degradation tooltip', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const cards = screen.getAllByTestId('choice-card');
        const firstCard = cards[0];
        if (!firstCard) {
            throw new Error('expected a choice card');
        }
        expect(firstCard).not.toHaveAttribute('title');
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
