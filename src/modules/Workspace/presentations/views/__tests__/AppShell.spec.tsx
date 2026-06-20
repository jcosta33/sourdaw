import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';

import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { AppShell } from '../AppShell';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('../../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(),
}));

vi.mock('../../hooks/useAppEventHandlers', () => ({
    useAppEventHandlers: vi.fn(),
}));

vi.mock('#/modules/Command/presentations/hooks/useCommandShortcuts', () => ({
    useCommandShortcuts: vi.fn(),
}));

vi.mock('#/modules/Command/presentations/hooks/useCommandLifecycle', () => ({
    useCommandLifecycle: vi.fn(),
}));

vi.mock('../../hooks/useTimelineCoordinates', () => ({
    useTimelineCoordinates: vi.fn(() => ({
        beatToX: vi.fn(),
        trackIdToY: vi.fn(),
        trackHeight: 100,
    })),
}));

// Mock child components
vi.mock('../TransportBar', () => ({
    TransportBar: () => <div data-testid="transport-bar">TransportBar</div>,
}));

vi.mock('#/modules/Collaboration/presentations/views/PresenceOverlay', () => ({
    PresenceOverlay: () => <div data-testid="presence-overlay">PresenceOverlay</div>,
}));

vi.mock('../Sidebar', () => ({
    Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock('../MixerPanel', () => ({
    MixerPanel: () => <div data-testid="mixer-panel">Mixer</div>,
}));

vi.mock('../ShortcutsSection', () => ({
    ShortcutsSection: () => <div data-testid="shortcuts-section">Shortcuts</div>,
}));

vi.mock('#/modules/AiRuntime/presentations/views/GenerativeAiPanel', () => ({
    GenerativeAiPanel: () => <div data-testid="ai-panel">AI Panel</div>,
}));

vi.mock('#/modules/Project/presentations/views/RecentProjectsMenu', () => ({
    RecentProjectsMenu: () => <div data-testid="recent-projects">Recent Projects</div>,
}));

vi.mock('#/modules/Collaboration/presentations/views', () => ({
    CollaborationPanel: () => <div data-testid="collab-panel">Collaboration</div>,
}));

vi.mock('#/modules/CrdtDocument/presentations/views', () => ({
    BranchManagerDialog: () => <div data-testid="branch-manager">Branch Manager</div>,
}));

describe('AppShell', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default implementation to avoid errors
        vi.mocked(useStore).mockImplementation((store, defaultValue) => {
            if (store.name === 'preferencesStore') {
                return { panelPlacementSidebar: 'left' };
            }
            if (store.name === 'projectStore') {
                return { initialized: true, loading: false };
            }
            return defaultValue || { past: [], future: [] };
        });

        vi.mocked(useWorkspaceState).mockReturnValue({
            sidebarOpen: true,
            inspectorOpen: false,
            mixerOpen: false,
            collaborationPanelOpen: false,
            branchManagerOpen: false,
            chatPanelOpen: false,
            selectedClipId: null,
            sidebarWidth: 200,
            inspectorWidth: 200,
            mixerHeight: 200,
            chatPanelWidth: 200,
            aiPanelWidth: 200,
            virtualKeyboardOpen: false,
        } as ReturnType<typeof useWorkspaceState>);
    });

    it('should render correctly when project is loaded', () => {
        render(<AppShell>Content</AppShell>);
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('should not render sidebar when closed', () => {
        vi.mocked(useWorkspaceState).mockReturnValue({
            sidebarOpen: false,
        } as ReturnType<typeof useWorkspaceState>);

        render(<AppShell>Content</AppShell>);
        expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    });

    it('should have correct layout structure', () => {
        render(<AppShell>Content</AppShell>);
        const shell = screen.getByTestId('app-shell');
        expect(shell.classList.contains('flex')).toBe(true);
    });

    describe('bottom-dock accessibility (Fix 1)', () => {
        beforeEach(() => {
            vi.mocked(useWorkspaceState).mockReturnValue({
                sidebarOpen: false,
                inspectorOpen: false,
                mixerOpen: true,
                collaborationPanelOpen: false,
                branchManagerOpen: false,
                chatPanelOpen: false,
                selectedClipId: null,
                sidebarWidth: 200,
                inspectorWidth: 200,
                mixerHeight: 200,
                chatPanelWidth: 200,
                aiPanelWidth: 200,
                virtualKeyboardOpen: false,
            } as ReturnType<typeof useWorkspaceState>);
        });

        it('exposes the dock as a tablist with role=tab buttons', () => {
            render(<AppShell>Content</AppShell>);
            const tablist = screen.getByRole('tablist', { name: 'Bottom dock' });
            expect(tablist).toBeInTheDocument();
            // The Close-dock icon button must NOT be inside the tablist.
            const tabs = screen.getAllByRole('tab');
            expect(tabs.length).toBeGreaterThanOrEqual(9);
            expect(tabs.map((t) => t.textContent)).toContain('Mixer');
        });

        it('marks the active tab aria-selected and the rest unselected', () => {
            render(<AppShell>Content</AppShell>);
            // default bottomTab is 'mixer'
            const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
            expect(selected).toHaveLength(1);
            expect(selected[0]?.textContent).toBe('Mixer');
        });

        it('wires the active tab to the tabpanel via aria-controls/aria-labelledby', () => {
            render(<AppShell>Content</AppShell>);
            const panel = screen.getByRole('tabpanel');
            const activeTab = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true');
            expect(activeTab?.getAttribute('aria-controls')).toBe(panel.id);
            expect(panel.getAttribute('aria-labelledby')).toBe(activeTab?.id);
        });
    });

    describe('skip-link resilience (Fix 2)', () => {
        it('renders a skip-link targeting #main-content when no dialog is open', () => {
            render(<AppShell>Content</AppShell>);
            const link = screen.getByText('Skip to content');
            expect(link.getAttribute('href')).toBe('#main-content');
        });

        it('removes the skip-link from the DOM while a modal dialog is open', () => {
            vi.mocked(useWorkspaceState).mockReturnValue({
                sidebarOpen: false,
                inspectorOpen: false,
                mixerOpen: false,
                collaborationPanelOpen: true,
                branchManagerOpen: false,
                chatPanelOpen: false,
                selectedClipId: null,
                sidebarWidth: 200,
                inspectorWidth: 200,
                mixerHeight: 200,
                chatPanelWidth: 200,
                aiPanelWidth: 200,
                virtualKeyboardOpen: false,
            } as ReturnType<typeof useWorkspaceState>);

            render(<AppShell>Content</AppShell>);
            expect(screen.queryByText('Skip to content')).not.toBeInTheDocument();
        });
    });
});
