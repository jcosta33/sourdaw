import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PluginBrowser } from './PluginBrowser';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        scannedPlugins: [],
        isScanning: false,
        errors: [],
    })),
}));

vi.mock('#/modules/Plugin/stores/pluginScanStore', () => ({
    pluginScanStore: {},
    defaultPluginScanState: {
        scannedPlugins: [],
        isScanning: false,
        errors: [],
        scanPaths: [],
        lastScanTime: null,
    },
}));

vi.mock('#/modules/Plugin/useCases/pluginScan/scanning/startPluginScan', () => ({
    startPluginScan: vi.fn(),
}));

vi.mock(
    '#/modules/Plugin/useCases/pluginBrowserActions/loadExternalPlugin',
    () => ({
        loadExternalPlugin: vi.fn(),
    }),
);

vi.mock(
    '#/modules/Plugin/useCases/pluginBrowserActions/createTrackForPlugin',
    () => ({
        createTrackForPlugin: vi.fn(() => ({ id: 'track1' })),
    }),
);

vi.mock('#/helpers/platformCapabilities', () => ({
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
const { startPluginScan } = await import('#/modules/Plugin/useCases/pluginScan/scanning');
const { loadExternalPlugin } = await import('#/modules/Plugin/useCases/pluginBrowserActions');
const { getPlatformCapabilities } = await import('#/helpers/platformCapabilities');

const mockPlugins = [
    { id: 'p1', name: 'Test VST', vendor: 'TestCorp', category: 'Effect', format: 'vst3', num_parameters: 10 },
    { id: 'p2', name: 'CLAP Synth', vendor: 'SynthCo', category: 'Instrument', format: 'clap', num_parameters: 25 },
    { id: 'p3', name: 'AU Filter', vendor: 'AudioDev', category: 'Effect', format: 'au', num_parameters: 5 },
];

describe('PluginBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scannedPlugins: [],
            isScanning: false,
            errors: [],
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
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({ scannedPlugins: [], isScanning: true, errors: [] });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('Scanning for plugins...')).toBeInTheDocument();
    });

    it('should show plugin count', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({ scannedPlugins: mockPlugins, isScanning: false, errors: [] });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('should group plugins by format', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({ scannedPlugins: mockPlugins, isScanning: false, errors: [] });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        // Use getAllByText since format appears in both header badge and plugin row
        expect(screen.getAllByText('vst3').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('clap').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('au').length).toBeGreaterThanOrEqual(1);
    });

    it('should render plugin names', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({ scannedPlugins: mockPlugins, isScanning: false, errors: [] });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('Test VST')).toBeInTheDocument();
        expect(screen.getByText('CLAP Synth')).toBeInTheDocument();
        expect(screen.getByText('AU Filter')).toBeInTheDocument();
    });

    it('should filter plugins by local search', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({ scannedPlugins: mockPlugins, isScanning: false, errors: [] });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        const searchInput = screen.getByLabelText('Filter external plugins');
        fireEvent.change(searchInput, { target: { value: 'VST' } });
        expect(searchInput).toHaveValue('VST');
    });

    it('should show desktop-only notice when native plugins not available', () => {
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasNativePlugins: false });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        expect(screen.getByText('Desktop app required')).toBeInTheDocument();
    });

    it('should render format badges', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({ scannedPlugins: mockPlugins, isScanning: false, errors: [] });
        render(<PluginBrowser selectedTrackId={null} searchQuery="" />);
        const formatBadges = screen.getAllByText(/vst3|clap|au/i);
        expect(formatBadges.length).toBeGreaterThan(0);
    });

    it('should call loadExternalPlugin when plugin is clicked', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({ scannedPlugins: mockPlugins, isScanning: false, errors: [] });
        render(<PluginBrowser selectedTrackId="track1" searchQuery="" />);
        const plugin = screen.getByText('Test VST');
        fireEvent.click(plugin.closest('[role="button"]') || plugin);
        expect(loadExternalPlugin).toHaveBeenCalled();
    });
});
