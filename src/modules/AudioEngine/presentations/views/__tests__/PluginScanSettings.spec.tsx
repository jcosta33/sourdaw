import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PluginScanSettings } from '../PluginScanSettings';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        scanPaths: ['/path/to/plugins', '/another/path'],
        scannedPlugins: [],
        isScanning: false,
        errors: [],
        notices: [],
        lastScanTime: null,
    })),
}));

vi.mock('#/modules/PluginHost/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/stores')>()),
    pluginScanStore: {},
    defaultPluginScanState: {
        scanPaths: [],
        scannedPlugins: [],
        isScanning: false,
        errors: [],
        notices: [],
        lastScanTime: null,
    },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    removeScanPath: vi.fn(),
    addScanPath: vi.fn(),
    startPluginScan: vi.fn(),
}));

vi.mock('#/utils/platformCapabilities', () => ({
    getPlatformCapabilities: vi.fn(() => ({ hasPluginScanning: true })),
    DISABLED_REASONS: { pluginScanning: 'Plugin scanning requires desktop app' },
}));

// Mock Tooltip components
vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { useStore } = await import('#/infra/store/useStore');
const { startPluginScan, addScanPath, removeScanPath } = await import('#/modules/PluginHost/useCases');
const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');

describe('PluginScanSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: ['/path/to/plugins', '/another/path'],
            scannedPlugins: [],
            isScanning: false,
            errors: [],
            notices: [],
            lastScanTime: null,
        });
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasPluginScanning: true });
    });

    it('should render without crashing', () => {
        const { container } = render(<PluginScanSettings />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render Plugin Paths header', () => {
        render(<PluginScanSettings />);
        expect(screen.getByText('Plugin Paths')).toBeInTheDocument();
    });

    it('should render scan paths', () => {
        render(<PluginScanSettings />);
        expect(screen.getByText('/path/to/plugins')).toBeInTheDocument();
        expect(screen.getByText('/another/path')).toBeInTheDocument();
    });

    it('should render input for new path', () => {
        render(<PluginScanSettings />);
        expect(screen.getByPlaceholderText('/path/to/plugins...')).toBeInTheDocument();
    });

    it('should call addScanPath when new path is added', () => {
        render(<PluginScanSettings />);
        const input = screen.getByPlaceholderText('/path/to/plugins...');
        fireEvent.change(input, { target: { value: '/new/path' } });
        const addButton = screen.getByLabelText('Add plugin path');
        fireEvent.click(addButton);
        expect(addScanPath).toHaveBeenCalledWith('/new/path');
    });

    it('should call removeScanPath when remove button is clicked', () => {
        render(<PluginScanSettings />);
        const removeButtons = screen.getAllByLabelText(/Remove path/);
        fireEvent.click(removeButtons[0]!);
        expect(removeScanPath).toHaveBeenCalledWith('/path/to/plugins');
    });

    it('should call startPluginScan when scan button is clicked', () => {
        render(<PluginScanSettings />);
        const scanButton = screen.getByText('Scan Now');
        fireEvent.click(scanButton);
        expect(startPluginScan).toHaveBeenCalled();
    });

    it('should show scanning state', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: [],
            scannedPlugins: [],
            isScanning: true,
            errors: [],
            notices: [],
            lastScanTime: null,
        });
        render(<PluginScanSettings />);
        expect(screen.getByText('Scanning...')).toBeInTheDocument();
    });

    it('should show plugins found count', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: [],
            scannedPlugins: [{ id: 'p1' }, { id: 'p2' }],
            isScanning: false,
            errors: [],
            notices: [],
            lastScanTime: null,
        });
        render(<PluginScanSettings />);
        expect(screen.getByText('Plugins Found')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('should show last scan time', () => {
        const now = Date.now();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: [],
            scannedPlugins: [],
            isScanning: false,
            errors: [],
            notices: [],
            lastScanTime: now,
        });
        render(<PluginScanSettings />);
        expect(screen.getByText('Last Scan')).toBeInTheDocument();
    });

    it('should show error messages', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: [],
            scannedPlugins: [],
            isScanning: false,
            errors: ['Failed to scan /invalid/path'],
            notices: [],
            lastScanTime: null,
        });
        render(<PluginScanSettings />);
        expect(screen.getByText('Failed to scan /invalid/path')).toBeInTheDocument();
    });

    it('should show success badge when all plugins scanned', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: ['/path'],
            scannedPlugins: [{ id: 'p1' }],
            isScanning: false,
            errors: [],
            notices: [],
            lastScanTime: Date.now(),
        });
        render(<PluginScanSettings />);
        expect(screen.getByText('All plugins scanned successfully')).toBeInTheDocument();
    });

    it('should show desktop-only notice when plugin scanning not available', () => {
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasPluginScanning: false });
        render(<PluginScanSettings />);
        expect(screen.getByText('Desktop app required')).toBeInTheDocument();
    });

    it('should add path on Enter key', () => {
        render(<PluginScanSettings />);
        const input = screen.getByPlaceholderText('/path/to/plugins...');
        fireEvent.change(input, { target: { value: '/new/path' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(addScanPath).toHaveBeenCalledWith('/new/path');
    });

    // ── branch coverage: handler guards and success-badge short-circuits ──────

    it('does not call addScanPath when the input is empty or whitespace', () => {
        render(<PluginScanSettings />);
        const input = screen.getByPlaceholderText('/path/to/plugins...');
        const addButton = screen.getByLabelText('Add plugin path');
        // Empty trimmed path ⇒ handleAddPath `if (trimmed)` false arm.
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.click(addButton);
        expect(addScanPath).not.toHaveBeenCalled();
    });

    it('does not call addScanPath for a non-Enter keypress', () => {
        render(<PluginScanSettings />);
        const input = screen.getByPlaceholderText('/path/to/plugins...');
        fireEvent.change(input, { target: { value: '/new/path' } });
        // Non-Enter key ⇒ `if (event.key === 'Enter')` false arm.
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(addScanPath).not.toHaveBeenCalled();
    });

    it('does not show the success badge when plugins exist but errors are present', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: ['/path'],
            scannedPlugins: [{ id: 'p1' }],
            isScanning: false,
            errors: ['scan error'],
            notices: [],
            lastScanTime: null,
        });
        render(<PluginScanSettings />);
        expect(screen.queryByText('All plugins scanned successfully')).not.toBeInTheDocument();
    });

    it('does not show the success badge while a scan is in progress', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: ['/path'],
            scannedPlugins: [{ id: 'p1' }],
            isScanning: true,
            errors: [],
            notices: [],
            lastScanTime: null,
        });
        render(<PluginScanSettings />);
        expect(screen.queryByText('All plugins scanned successfully')).not.toBeInTheDocument();
    });

    it('renders the empty state for scan paths without a paths list', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: [],
            scannedPlugins: [],
            isScanning: false,
            errors: [],
            notices: [],
            lastScanTime: null,
        });
        render(<PluginScanSettings />);
        // No remove buttons when paths list is empty.
        expect(screen.queryAllByLabelText(/Remove path/)).toHaveLength(0);
    });
});
