import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('../../hooks/useAppKeyboardShortcuts', () => ({
    useAppKeyboardShortcuts: vi.fn(),
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

describe('AppShell', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default implementation to avoid errors
        vi.mocked(useStore).mockImplementation((store, defaultValue) => {
            if (store && store.name === 'preferencesStore') {
                return { panelPlacementSidebar: 'left' };
            }
            if (store && store.name === 'projectStore') {
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
        } as any);
    });

    it('should render correctly when project is loaded', () => {
        render(<AppShell>Content</AppShell>);
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('should not render sidebar when closed', () => {
        vi.mocked(useWorkspaceState).mockReturnValue({
            sidebarOpen: false,
        } as any);

        render(<AppShell>Content</AppShell>);
        expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    });

    it('should have correct layout structure', () => {
        render(<AppShell>Content</AppShell>);
        const shell = screen.getByTestId('app-shell');
        expect(shell.classList.contains('flex')).toBe(true);
    });
});
