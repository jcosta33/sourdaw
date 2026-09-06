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
    scannedPlugins: Array<{
        id: string;
        name: string;
        format: string;
        descriptor_id?: string;
        has_custom_ui?: boolean;
        capability_metadata_reason?: string;
    }>;
};

type TestPluginGuiState = {
    byInstanceId: Record<string, { isOpen: boolean; error?: string }>;
};

type TestActivationState = {
    byInstanceId: Record<string, { status: 'loading' | 'active' | 'error'; message?: string }>;
};

// Mock external dependencies
const mockBypassDevice = vi.fn<(deviceId: string, bypassed: boolean) => void>();
const mockRemoveDevice = vi.fn<(deviceId: string) => void>();
const mockAddDevice = vi.fn<(trackId: string, pluginName: string) => void>();
const mockExecuteAddDeviceAction = vi.fn<(trackId: string, deviceType: string) => void>();
const mockCompileReorderDevicesAction = vi.fn();
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
        executeAddDeviceAction: (trackId: string, deviceType: string): Promise<unknown> => {
            mockExecuteAddDeviceAction(trackId, deviceType);
            return Promise.resolve({ status: 'applied', deviceId: 'device-added' });
        },
        compileReorderDevicesAction: (trackId: string, deviceId: string, targetDeviceId: string): unknown =>
            mockCompileReorderDevicesAction(trackId, deviceId, targetDeviceId),
        projectTrackToLiveStrip: (input: { trackId: string; activateDormantExternalPlugins: boolean }): void => {
            mockProjectTrackToLiveStrip(input);
        },
        getPlatformPlugins: () => mockGetPlatformPlugins(),
        getPluginById: (id: string) => mockGetPluginById(id),
    };
});

const mockExecuteUserAppAction = vi.fn<(action: unknown) => void>();

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
    executeUserAppAction: (action: unknown): void => {
        mockExecuteUserAppAction(action);
    },
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
}));

const mockOpenPluginGui = vi.fn<(instanceId: string) => Promise<void>>();
const mockClosePluginGui = vi.fn<(instanceId: string) => Promise<void>>();
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        openPluginGui: (instanceId: string): Promise<void> => mockOpenPluginGui(instanceId),
        closePluginGui: (instanceId: string): Promise<void> => mockClosePluginGui(instanceId),
    };
});

const mockShowDevicePanelForType = vi.fn<(deviceType: string, deviceId: string) => void>();
vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    showDevicePanelForType: (deviceType: string, deviceId: string): void => {
        mockShowDevicePanelForType(deviceType, deviceId);
    },
}));

const mockStores = vi.hoisted(() => ({ scan: {}, activation: {}, gui: {} }));
const mockScanState = vi.fn<() => TestPluginScanViewState>(() => ({
    scannedPlugins: [],
}));
const mockActivationState = vi.fn<() => TestActivationState>(() => ({ byInstanceId: {} }));
const mockGuiState = vi.fn<() => TestPluginGuiState>(() => ({ byInstanceId: {} }));
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown): unknown => {
        if (store === mockStores.activation) {
            return mockActivationState();
        }
        if (store === mockStores.gui) {
            return mockGuiState();
        }
        return mockScanState();
    },
}));

vi.mock('#/modules/PluginHost/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/stores')>();
    return {
        ...actual,
        pluginScanStore: mockStores.scan,
        defaultPluginScanState: { scannedPlugins: [] },
        externalPluginActivationStore: mockStores.activation,
        defaultExternalPluginActivationState: { byInstanceId: {} },
        pluginGuiStore: mockStores.gui,
        defaultPluginGuiState: { byInstanceId: {} },
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
        variant,
        size,
        asChild: _asChild,
        ...props
    }: React.ComponentProps<'button'> & { variant?: string; size?: string; asChild?: boolean }) => (
        <button type="button" data-testid="button" data-variant={variant} data-size={size} {...props}>
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
        onDragStart,
        onDrop,
        className,
        title,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
        onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
        className?: string;
        title?: string;
    }) => (
        <div
            data-testid="choice-card"
            className={className}
            title={title}
            onClick={onClick}
            onDragStart={onDragStart}
            onDrop={onDrop}
        >
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
        mockGuiState.mockReturnValue({ byInstanceId: {} });
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

    it('should dispatch the bypassDevice action when bypass button is clicked', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const bypassButton = screen.getByLabelText('Bypass Compressor');
        fireEvent.click(bypassButton);
        // Action boundary: the action is undoable; the raw use-case write
        // this replaced never entered history.
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith({
            type: 'bypassDevice',
            payload: { deviceId: 'device-1', bypassed: true },
        });
    });

    it('should dispatch the removeDevice action when remove button is clicked', () => {
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        const removeButton = screen.getByLabelText('Remove Compressor');
        fireEvent.click(removeButton);
        // removeDevice is undoable via its restoreDevice inverse.
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith({
            type: 'removeDevice',
            payload: { deviceId: 'device-1' },
        });
    });

    it('routes a mixer device drop through the committed reorder action', () => {
        const action = { type: 'reorderDevices', payload: { trackId: 'track-1' } };
        mockCompileReorderDevicesAction.mockReturnValue(action);
        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);

        const cards = screen.getAllByTestId('choice-card');
        const draggedCard = cards[0];
        const targetCard = cards[1];
        if (!draggedCard || !targetCard) {
            throw new Error('expected device cards');
        }
        const dataTransfer = {
            effectAllowed: '',
            dropEffect: '',
            getData: vi.fn(() => 'device-1'),
            setData: vi.fn(),
        };

        fireEvent.dragStart(draggedCard, { dataTransfer });
        fireEvent.drop(targetCard, { dataTransfer });

        expect(mockCompileReorderDevicesAction).toHaveBeenCalledWith('track-1', 'device-1', 'device-2');
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith(action);
    });

    it('should add a platform device from the menu and close the menu', () => {
        mockGetPlatformPlugins.mockReturnValue([{ id: 'chorus', name: 'Chorus', category: 'effect' }]);

        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);

        fireEvent.click(screen.getByLabelText('Add device'));

        const chorusMenuItem = screen.getByRole('menuitem', { name: 'Chorus' });
        expect(chorusMenuItem.tagName).toBe('BUTTON');

        fireEvent.click(chorusMenuItem);

        // The menu routes through the guarded dispatch door so the add is one
        // Automerge transaction (undoable), by plugin id — not the label — and
        // a committed-degraded runtime outcome cannot escape as an unhandled
        // rejection.
        expect(mockExecuteAddDeviceAction).toHaveBeenCalledWith('track-1', 'chorus');
        expect(mockAddDevice).not.toHaveBeenCalled();
        expect(screen.queryByRole('menuitem', { name: 'Chorus' })).not.toBeInTheDocument();
    });

    it('offers only the plugin formats the host can load from stale scan state', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [
                { id: 'vst-1', name: 'Working VST', format: 'vst3' },
                { id: 'clap-1', name: 'Working CLAP', format: 'clap' },
                { id: 'au-1', name: 'Stale AU', format: 'au' },
            ],
        });

        render(<TrackDevicesSection track={mockTrack} onSelectDevice={mockOnSelectDevice} />);
        fireEvent.click(screen.getByLabelText('Add device'));

        // The menu tracks what the host can actually load, and VST3 became
        // loadable in #2869 — offering it is now correct, and hiding it was the
        // stale assertion.
        expect(screen.getByRole('menuitem', { name: /Working VST/ })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: /Stale AU/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: /Working CLAP/ }));
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'clap-1', trackId: 'track-1' },
        });
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
        mockActivationState.mockReturnValue({ byInstanceId: { 'legacy-instance': { status: 'active' } } });

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
                    descriptor_id: 'com.vendor.persisted-clap',
                    name: 'Persisted CLAP',
                    format: 'clap',
                },
            ],
        });
        mockActivationState.mockReturnValue({
            byInstanceId: { 'persisted-instance': { status: 'active' } },
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
        expect(mockExecuteUserAppAction).not.toHaveBeenCalled();
    });

    it('surfaces a degraded plugin that activated without a running native engine and keeps its editor control', () => {
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
        expect(screen.getByLabelText('Open editor for Dormant CLAP')).toBeInTheDocument();
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

    const externalPluginTrack = (externalPluginId: string, externalInstanceId: string, name: string): Track => ({
        ...mockTrack,
        devices: [
            {
                id: 'external-slot',
                name,
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId,
                externalInstanceId,
            },
        ],
    });

    it('offers no editor control while the instance is still loading', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'path-hash', name: 'Massive X', format: 'vst3', has_custom_ui: true }],
        });
        mockActivationState.mockReturnValue({
            byInstanceId: { 'loading-instance': { status: 'loading' } },
        });

        render(
            <TrackDevicesSection
                track={externalPluginTrack('path-hash', 'loading-instance', 'Massive X')}
                onSelectDevice={mockOnSelectDevice}
            />
        );

        expect(screen.queryByLabelText('Open editor for Massive X')).not.toBeInTheDocument();
        expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Bypass Massive X')).toBeEnabled();
    });

    it('offers no editor control for an instance that was never activated', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'path-hash', name: 'Massive X', format: 'vst3', has_custom_ui: true }],
        });
        mockActivationState.mockReturnValue({ byInstanceId: {} });

        render(
            <TrackDevicesSection
                track={externalPluginTrack('path-hash', 'never-activated-instance', 'Massive X')}
                onSelectDevice={mockOnSelectDevice}
            />
        );

        expect(screen.queryByLabelText('Open editor for Massive X')).not.toBeInTheDocument();
        expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Bypass Massive X')).toBeEnabled();
    });

    it('offers no editor control for a plugin the scan reports has none', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'path-hash', name: 'Headless CLAP', format: 'clap', has_custom_ui: false }],
        });
        mockActivationState.mockReturnValue({ byInstanceId: { 'headless-instance': { status: 'active' } } });

        render(
            <TrackDevicesSection
                track={externalPluginTrack('path-hash', 'headless-instance', 'Headless CLAP')}
                onSelectDevice={mockOnSelectDevice}
            />
        );

        expect(screen.queryByLabelText(/editor for Headless CLAP/)).not.toBeInTheDocument();
        // Still a healthy device — it just has no editor of its own.
        expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    });

    it('keeps the editor control when the scan never queried the capability', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [
                {
                    id: 'path-hash',
                    name: 'Unqueried CLAP',
                    format: 'clap',
                    has_custom_ui: false,
                    capability_metadata_reason: 'the scanner did not inspect this plugin',
                },
            ],
        });
        mockActivationState.mockReturnValue({
            byInstanceId: { 'unqueried-instance': { status: 'active' } },
        });

        render(
            <TrackDevicesSection
                track={externalPluginTrack('path-hash', 'unqueried-instance', 'Unqueried CLAP')}
                onSelectDevice={mockOnSelectDevice}
            />
        );

        expect(screen.getByLabelText('Open editor for Unqueried CLAP')).toBeInTheDocument();
    });

    it('closes the editor from the control that opened it', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'path-hash', name: 'Open CLAP', format: 'clap', has_custom_ui: true }],
        });
        mockGuiState.mockReturnValue({ byInstanceId: { 'open-instance': { isOpen: true } } });
        mockActivationState.mockReturnValue({
            byInstanceId: { 'open-instance': { status: 'active' } },
        });

        render(
            <TrackDevicesSection
                track={externalPluginTrack('path-hash', 'open-instance', 'Open CLAP')}
                onSelectDevice={mockOnSelectDevice}
            />
        );

        const control = screen.getByLabelText('Close editor for Open CLAP');
        expect(control).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(control);

        expect(mockClosePluginGui).toHaveBeenCalledWith('open-instance');
        expect(mockOpenPluginGui).not.toHaveBeenCalled();
    });

    it('reads the editor as closed again once the OS ended its window', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'path-hash', name: 'Open CLAP', format: 'clap', has_custom_ui: true }],
        });
        mockGuiState.mockReturnValue({ byInstanceId: { 'open-instance': { isOpen: true } } });
        mockActivationState.mockReturnValue({
            byInstanceId: { 'open-instance': { status: 'active' } },
        });
        const track = externalPluginTrack('path-hash', 'open-instance', 'Open CLAP');
        const { rerender } = render(<TrackDevicesSection track={track} onSelectDevice={mockOnSelectDevice} />);
        expect(screen.getByLabelText('Close editor for Open CLAP')).toBeInTheDocument();

        // What the host reports when the window was closed from its title bar.
        mockGuiState.mockReturnValue({ byInstanceId: { 'open-instance': { isOpen: false } } });
        rerender(<TrackDevicesSection track={{ ...track }} onSelectDevice={mockOnSelectDevice} />);

        expect(screen.getByLabelText('Open editor for Open CLAP')).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Open editor for Open CLAP'));
        expect(mockOpenPluginGui).toHaveBeenCalledWith('open-instance');
        expect(mockClosePluginGui).not.toHaveBeenCalled();
    });

    it('surfaces the host refusal on the slot whose editor failed to open', () => {
        mockGetPlatformCapabilities.mockReturnValue({ hasNativePlugins: true });
        mockScanState.mockReturnValue({
            scannedPlugins: [{ id: 'path-hash', name: 'Refusing CLAP', format: 'clap', has_custom_ui: true }],
        });
        mockGuiState.mockReturnValue({
            byInstanceId: { 'refusing-instance': { isOpen: false, error: 'Plugin GUI is already open' } },
        });
        mockActivationState.mockReturnValue({
            byInstanceId: { 'refusing-instance': { status: 'active' } },
        });

        render(
            <TrackDevicesSection
                track={externalPluginTrack('path-hash', 'refusing-instance', 'Refusing CLAP')}
                onSelectDevice={mockOnSelectDevice}
            />
        );

        expect(screen.getByTestId('choice-card')).toHaveAttribute('title', 'Plugin GUI is already open');
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
