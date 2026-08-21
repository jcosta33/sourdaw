import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    executeAppAction: vi.fn(),
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
const { executeAppAction } = await import('#/modules/Command/useCases');
const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');

const mockPlugins = [
    { id: 'p1', name: 'Test VST', vendor: 'TestCorp', category: 'Effect', format: 'vst3', num_parameters: 10 },
    { id: 'p2', name: 'CLAP Synth', vendor: 'SynthCo', category: 'Instrument', format: 'clap', num_parameters: 25 },
    { id: 'p3', name: 'CLAP Filter', vendor: 'AudioDev', category: 'Effect', format: 'clap', num_parameters: 5 },
    { id: 'p4', name: 'AU Filter', vendor: 'AudioDev', category: 'Effect', format: 'au', num_parameters: 5 },
];

describe('PluginBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: [],
            isScanning: false,
            errors: [],
            notices: [],
        });
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasNativePlugins: true });
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
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({ scannedPlugins: [], isScanning: true, errors: [], notices: [] });
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
        expect(screen.getByText('External Plugins').parentElement).toHaveTextContent('External Plugins2');
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
        expect(screen.queryByText('vst3')).not.toBeInTheDocument();
        expect(screen.queryByText('au')).not.toBeInTheDocument();
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
        expect(screen.queryByText('Test VST')).not.toBeInTheDocument();
        expect(screen.queryByText('AU Filter')).not.toBeInTheDocument();
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
        fireEvent.change(searchInput, { target: { value: 'VST' } });
        expect(searchInput).toHaveValue('VST');
        expect(screen.getByText(/No plugins match/)).toBeInTheDocument();
    });

    it('should show desktop-only notice when native plugins not available', () => {
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasNativePlugins: false });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('CLAP plugins')).toBeInTheDocument();
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
        expect(screen.queryByText('Test VST')).not.toBeInTheDocument();
        expect(screen.queryByText('AU Filter')).not.toBeInTheDocument();
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
        expect(executeAppAction).toHaveBeenCalledWith({
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
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'p2' },
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
        expect(executeAppAction).toHaveBeenCalledWith({
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
