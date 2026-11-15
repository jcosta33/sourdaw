import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
        quarantined: [],
        grantedFolders: [],
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
        quarantined: [],
        grantedFolders: [],
    },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    removeScanPath: vi.fn(),
    addPluginFolder: vi.fn(),
    removePluginFolder: vi.fn(),
    refreshPluginFolderGrants: vi.fn(),
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
const { startPluginScan, addPluginFolder, removePluginFolder, refreshPluginFolderGrants, removeScanPath } =
    await import('#/modules/PluginHost/useCases');
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
            quarantined: [],
            grantedFolders: [],
        });
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasPluginScanning: true });
        (addPluginFolder as ReturnType<typeof vi.fn>).mockResolvedValue({ added: true, path: '/Users/me/Plugins' });
        (removePluginFolder as ReturnType<typeof vi.fn>).mockResolvedValue({ removed: true });
        (refreshPluginFolderGrants as ReturnType<typeof vi.fn>).mockResolvedValue({ refreshed: true });
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
            quarantined: [],
            grantedFolders: [],
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
            quarantined: [],
            grantedFolders: [],
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
            quarantined: [],
            grantedFolders: [],
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
            quarantined: [],
            grantedFolders: [],
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
            quarantined: [],
            grantedFolders: [],
        });
        render(<PluginScanSettings />);
        expect(screen.getByText('All plugins scanned successfully')).toBeInTheDocument();
    });

    it('should show desktop-only notice when plugin scanning not available', () => {
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasPluginScanning: false });
        render(<PluginScanSettings />);
        expect(screen.getByText('Desktop app required')).toBeInTheDocument();
    });

    // ── branch coverage: handler guards and success-badge short-circuits ──────

    it('does not show the success badge when plugins exist but errors are present', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: ['/path'],
            scannedPlugins: [{ id: 'p1' }],
            isScanning: false,
            errors: ['scan error'],
            notices: [],
            lastScanTime: null,
            quarantined: [],
            grantedFolders: [],
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
            quarantined: [],
            grantedFolders: [],
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
            quarantined: [],
            grantedFolders: [],
        });
        render(<PluginScanSettings />);
        // No remove buttons when paths list is empty.
        expect(screen.queryAllByLabelText(/Remove path/)).toHaveLength(0);
    });

    // ── quarantine section (#2911) ─────────────────────────────────────────

    it('shows no quarantine section when nothing is quarantined', () => {
        render(<PluginScanSettings />);
        expect(screen.queryByText(/quarantined/)).not.toBeInTheDocument();
        expect(screen.queryByText('Retry Quarantined')).not.toBeInTheDocument();
    });

    it('shows a quarantined badge naming the quarantined path and its retry affordance', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: [],
            scannedPlugins: [],
            isScanning: false,
            errors: [],
            notices: [],
            lastScanTime: null,
            quarantined: [
                {
                    path: '/plugins/broken.vst3',
                    reason: 'Plugin scan helper timed out',
                    quarantined_at_ms: 1_700_000_000_000,
                },
            ],
            grantedFolders: [],
        });
        render(<PluginScanSettings />);
        expect(screen.getByText('1 quarantined')).toBeInTheDocument();
        expect(screen.getByText('/plugins/broken.vst3')).toBeInTheDocument();
        expect(screen.getByText('Retry Quarantined')).toBeInTheDocument();
    });

    it('calls startPluginScan with an explicit retry flag when Retry Quarantined is clicked', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: [],
            scannedPlugins: [],
            isScanning: false,
            errors: [],
            notices: [],
            lastScanTime: null,
            quarantined: [
                { path: '/plugins/broken.vst3', reason: 'Plugin scan helper timed out', quarantined_at_ms: 1 },
            ],
            grantedFolders: [],
        });
        render(<PluginScanSettings />);
        fireEvent.click(screen.getByText('Retry Quarantined'));
        expect(startPluginScan).toHaveBeenCalledWith({ retryQuarantined: true });
    });

    // ── added plugin folders (#6574) ──────────────────────────────────────

    const withGrantedFolders = (grantedFolders: { path: string; unavailableReason: string | null }[]) => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            scanPaths: [],
            scannedPlugins: [],
            isScanning: false,
            errors: [],
            notices: [],
            lastScanTime: null,
            quarantined: [],
            grantedFolders,
        });
    };

    it('offers an Add Folder button in place of a typed path', () => {
        render(<PluginScanSettings />);

        expect(screen.getByRole('button', { name: 'Add Folder' })).toBeEnabled();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('asks the shell to pick and grant a folder when Add Folder is clicked', async () => {
        render(<PluginScanSettings />);

        fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

        await waitFor(() => {
            expect(addPluginFolder).toHaveBeenCalledTimes(1);
        });
        expect(addPluginFolder).toHaveBeenCalledWith();
    });

    it('disables Add Folder while an add is in flight', async () => {
        let finish = (_outcome: { added: true; path: string }): void => {};
        (addPluginFolder as ReturnType<typeof vi.fn>).mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        render(<PluginScanSettings />);
        const button = screen.getByRole('button', { name: 'Add Folder' });

        fireEvent.click(button);
        await waitFor(() => {
            expect(button).toBeDisabled();
        });

        finish({ added: true, path: '/Users/me/Plugins' });
        await waitFor(() => {
            expect(button).toBeEnabled();
        });
    });

    it('announces the refusal reason the native policy gave', async () => {
        (addPluginFolder as ReturnType<typeof vi.fn>).mockResolvedValue({
            added: false,
            reason: '/Volumes/USB is a symlinked folder and cannot be scanned',
        });
        render(<PluginScanSettings />);

        fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            '/Volumes/USB is a symlinked folder and cannot be scanned'
        );
    });

    it('shows nothing when the picker is cancelled', async () => {
        (addPluginFolder as ReturnType<typeof vi.fn>).mockResolvedValue({ added: false, cancelled: true });
        render(<PluginScanSettings />);

        fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Add Folder' })).toBeEnabled();
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('reads the added folders from the native side when settings open', async () => {
        render(<PluginScanSettings />);

        await waitFor(() => {
            expect(refreshPluginFolderGrants).toHaveBeenCalledTimes(1);
        });
    });

    it('does not read added folders outside the desktop app', () => {
        (getPlatformCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({ hasPluginScanning: false });
        render(<PluginScanSettings />);

        expect(refreshPluginFolderGrants).not.toHaveBeenCalled();
    });

    it('lists no added folders section when none are granted', () => {
        render(<PluginScanSettings />);

        expect(screen.queryByRole('list', { name: 'Added folders' })).not.toBeInTheDocument();
    });

    it('lists each added folder with its unavailable reason and a Remove control', () => {
        withGrantedFolders([
            { path: '/Users/me/Plugins', unavailableReason: null },
            { path: '/Volumes/USB/Plugins', unavailableReason: 'The folder is not available' },
        ]);
        render(<PluginScanSettings />);

        const list = screen.getByRole('list', { name: 'Added folders' });
        expect(list).toHaveTextContent('/Users/me/Plugins');
        expect(list).toHaveTextContent('/Volumes/USB/Plugins');
        expect(screen.getByText('The folder is not available')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove plugin folder /Users/me/Plugins' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove plugin folder /Volumes/USB/Plugins' })).toBeInTheDocument();
    });

    it('removes the folder its Remove control names', async () => {
        withGrantedFolders([
            { path: '/Users/me/Plugins', unavailableReason: null },
            { path: '/Users/me/Plugins-old', unavailableReason: null },
        ]);
        render(<PluginScanSettings />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove plugin folder /Users/me/Plugins-old' }));

        await waitFor(() => {
            expect(removePluginFolder).toHaveBeenCalledWith('/Users/me/Plugins-old');
        });
        expect(removePluginFolder).toHaveBeenCalledTimes(1);
    });

    it('announces an added folder politely', async () => {
        render(<PluginScanSettings />);

        fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Added /Users/me/Plugins');
    });

    it('moves focus to Add Folder and announces the removal once a folder is removed', async () => {
        withGrantedFolders([{ path: '/Users/me/Plugins', unavailableReason: null }]);
        render(<PluginScanSettings />);
        const remove = screen.getByRole('button', { name: 'Remove plugin folder /Users/me/Plugins' });

        remove.focus();
        fireEvent.click(remove);

        expect(await screen.findByRole('status')).toHaveTextContent('Removed /Users/me/Plugins');
        expect(screen.getByRole('button', { name: 'Add Folder' })).toHaveFocus();
    });

    it('announces a failed removal', async () => {
        withGrantedFolders([{ path: '/Users/me/Plugins', unavailableReason: null }]);
        (removePluginFolder as ReturnType<typeof vi.fn>).mockResolvedValue({
            removed: false,
            reason: 'Could not remove /Users/me/Plugins: grant store is read-only',
        });
        render(<PluginScanSettings />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove plugin folder /Users/me/Plugins' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('grant store is read-only');
    });

    it('keeps Add Folder and Remove reachable from the keyboard', () => {
        // @testing-library/user-event is not a dependency, and jsdom does not
        // synthesize a native button's Enter/Space activation. What the
        // keyboard needs from this component is native, focusable buttons and
        // a Remove control that becomes visible on focus rather than only on
        // hover.
        withGrantedFolders([{ path: '/Users/me/Plugins', unavailableReason: null }]);
        render(<PluginScanSettings />);
        const add = screen.getByRole('button', { name: 'Add Folder' });
        const remove = screen.getByRole('button', { name: 'Remove plugin folder /Users/me/Plugins' });

        add.focus();
        expect(add).toHaveFocus();
        expect(add.tagName).toBe('BUTTON');
        remove.focus();
        expect(remove).toHaveFocus();
        expect(remove.tagName).toBe('BUTTON');
        expect(remove).toHaveClass('focus-visible:opacity-100');
        expect(remove).toHaveClass('group-focus-within:opacity-100');
    });
});
