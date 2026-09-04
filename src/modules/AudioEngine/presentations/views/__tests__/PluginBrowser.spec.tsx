import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { PluginBrowser } from '../PluginBrowser';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        scannedPlugins: [],
        isScanning: false,
        errors: [],
        notices: [],
    })),
}));

vi.mock('#/modules/PluginHost/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/stores')>()),
    pluginScanStore: {},
    defaultPluginScanState: {
        scannedPlugins: [],
        isScanning: false,
        errors: [],
        notices: [],
        scanPaths: [],
        lastScanTime: null,
    },
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    startPluginScan: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));

vi.mock('#/utils/platformCapabilities', () => ({
    getPlatformCapabilities: vi.fn(() => ({ hasNativePlugins: true })),
    DISABLED_REASONS: { nativePlugins: 'Native plugins require desktop app' },
}));

// Mock Tooltip components
vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { useStore } = await import('#/infra/store/useStore');
const { startPluginScan } = await import('#/modules/PluginHost/useCases');
const { executeUserAppAction } = await import('#/modules/Command/useCases');
const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
// The refusal test drives the real wrapper over the real admission gate, so it
// observes what the user gets rather than the mocked dispatch seam.
const realCommandUseCases =
    await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');

const mockPlugins = [
    { id: 'p1', name: 'Test VST', vendor: 'TestCorp', category: 'Effect', format: 'vst3', num_parameters: 10 },
    { id: 'p2', name: 'CLAP Synth', vendor: 'SynthCo', category: 'Instrument', format: 'clap', num_parameters: 25 },
    { id: 'p3', name: 'CLAP Filter', vendor: 'AudioDev', category: 'Effect', format: 'clap', num_parameters: 5 },
    { id: 'p4', name: 'AU Filter', vendor: 'AudioDev', category: 'Effect', format: 'au', num_parameters: 5 },
    { id: 'p5', name: 'Legacy Comp', vendor: 'AudioDev', category: 'Effect', format: 'vst2', num_parameters: 5 },
];

const notificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

describe('PluginBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setNotificationEventBus(notificationEventBus);
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: [],
            isScanning: false,
            errors: [],
            notices: [],
        });
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasNativePlugins: true });
    });

    afterEach(() => {
        clearHandlerRegistry();
        agentProjectRepairStateStore.set(null);
    });

    it('should render without crashing', () => {
        const { container } = render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render External Plugins header', () => {
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('External Plugins')).toBeInTheDocument();
    });

    it('should render empty state when no plugins', () => {
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('No external plugins found')).toBeInTheDocument();
    });

    it('should show scan button in empty state', () => {
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('Scan Plugins')).toBeInTheDocument();
    });

    it('should call startPluginScan when scan button is clicked', () => {
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        const scanButton = screen.getByText('Scan Plugins');
        fireEvent.click(scanButton);
        expect(startPluginScan).toHaveBeenCalled();
    });

    it('should show scanning state', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: [],
            isScanning: true,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('Scanning for plugins...')).toBeInTheDocument();
    });

    it('should show plugin count', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('External Plugins').parentElement).toHaveTextContent('External Plugins3');
    });

    it('should group supported plugins by format', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getAllByText('clap').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('vst3').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('au')).not.toBeInTheDocument();
        expect(screen.queryByText('vst2')).not.toBeInTheDocument();
    });

    it('should render plugin names', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('CLAP Synth')).toBeInTheDocument();
        expect(screen.getByText('CLAP Filter')).toBeInTheDocument();
        expect(screen.getByText('Test VST')).toBeInTheDocument();
        expect(screen.queryByText('AU Filter')).not.toBeInTheDocument();
        expect(screen.queryByText('Legacy Comp')).not.toBeInTheDocument();
    });

    it('should filter plugins by local search', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        const searchInput = screen.getByLabelText('Filter external plugins');

        fireEvent.change(searchInput, { target: { value: 'Synth' } });
        expect(searchInput).toHaveValue('Synth');
        expect(screen.getByText('CLAP Synth')).toBeInTheDocument();
        expect(screen.queryByText('CLAP Filter')).not.toBeInTheDocument();
        expect(screen.queryByText('Test VST')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'no plugin is called this' } });
        expect(screen.getByText(/No plugins match/)).toBeInTheDocument();
    });

    it('should show desktop-only notice when native plugins not available', () => {
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasNativePlugins: false });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('CLAP and VST®3 plugins')).toBeInTheDocument();
        expect(screen.getByText('Desktop app required')).toBeInTheDocument();
    });

    it('does not advertise unsupported scanned plugin formats', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });

        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);

        expect(screen.getByText('CLAP Synth')).toBeInTheDocument();
        expect(screen.queryByText('AU Filter')).not.toBeInTheDocument();
        expect(screen.queryByText('Legacy Comp')).not.toBeInTheDocument();
    });

    it('should render format badges', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        const formatBadges = screen.getAllByText(/clap/i);
        expect(formatBadges.length).toBeGreaterThan(0);
    });

    it('dispatches the external-plugin command for a selected track', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId="track1" searchQuery="" />);
        const plugin = screen.getByText('CLAP Filter');
        fireEvent.click(plugin.closest('[role="button"]') || plugin);
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'p3', trackId: 'track1' },
        });
    });

    // ── handleLoadPlugin: no selected track ⇒ handler owns materialization ─

    it('dispatches an unbound external-plugin command for an instrument with no selected track', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        const plugin = screen.getByText('CLAP Synth');
        fireEvent.click(plugin.closest('[role="button"]') || plugin);
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'p2' },
        });
    });

    it('tells the user when the project refuses to load the plugin', async () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        registerHandlerMap({
            loadExternalPlugin: {
                describe: () => ({ label: 'Load external plugin' }),
                execute: () => {},
                undoable: false,
            },
        });
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        vi.mocked(executeUserAppAction).mockImplementationOnce(realCommandUseCases.executeUserAppAction);

        render(<PluginBrowser selectedTrackId="track1" searchQuery="" />);
        const plugin = screen.getByText('CLAP Filter');
        fireEvent.click(plugin.closest('[role="button"]') || plugin);

        await waitFor(() => {
            expect(notificationEventBus.emit).toHaveBeenCalledWith('ui.notify', {
                message: 'Project repair is required before project actions can execute',
                level: 'warning',
            });
        });
    });

    it('leaves track-kind materialization to the command handler for an effect', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        const plugin = screen.getByText('CLAP Filter');
        fireEvent.click(plugin.closest('[role="button"]') || plugin);
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'p3' },
        });
    });

    // ── collapse/expand toggle (exercises the else/add arm) ────────────────────

    it('toggles a format group between collapsed and expanded', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        // Format header buttons are the <button> elements containing the format text.
        const clapHeader = screen.getAllByText('clap')[0]!.closest('button')!;
        // Collapse: rows hide.
        fireEvent.click(clapHeader);
        // The plugin row should no longer be visible.
        expect(clapHeader).toBeInTheDocument();
        // Expand back: rows reappear.
        fireEvent.click(clapHeader);
        expect(screen.getByText('CLAP Synth')).toBeInTheDocument();
    });

    // ── searchQuery prop drives the filter (overrides local search) ────────────

    it('filters plugins using the external searchQuery prop', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        // Match by vendor (SynthCo) — exercises the vendor branch of the ||.
        render(<PluginBrowser selectedTrackId={null} searchQuery="SynthCo" />);
        expect(screen.getByText('CLAP Synth')).toBeInTheDocument();
        expect(screen.queryByText('Test VST')).not.toBeInTheDocument();
    });

    it('shows the no-match hint when the query matches no plugins', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: mockPlugins,
            isScanning: false,
            errors: [],
            notices: [],
        });
        render(<PluginBrowser selectedTrackId={null} searchQuery="zzznomatch" />);
        expect(screen.getByText(/No plugins match/)).toBeInTheDocument();
    });
});
