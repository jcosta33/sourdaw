import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { useStore } from '#/infra/store/useStore';
import { aiStore } from '#/modules/AiGeneration/stores';
import { setVoiceToggleEventBus } from '#/modules/AiRuntime/useCases';
import {
    clipSelectionStore,
    trackStore,
    type Clip,
    type Track,
    type TrackStoreState,
} from '#/modules/Arrangement/stores';
import { setWebMidiRuntimeEventBus } from '#/modules/MIDI/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { defaultWorkspaceState, type WorkspaceState } from '../../../models/WorkspaceState';
import { alphaNoticeStore } from '../../../stores/alphaNoticeStore';
import { workspaceStore } from '../../../stores/workspaceStore';
import { setWorkspaceEventBus } from '../../../useCases/workspaceEventBus';
import { useProjectState } from '../../hooks/useProjectState';
import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { AppShell } from '../AppShell';

const elasticEditorPanelMock = vi.hoisted(() => vi.fn());
const dismissAlphaNoticeMock = vi.hoisted(() => vi.fn());

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('../../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(),
}));

vi.mock('../../hooks/useProjectState', () => ({
    useProjectState: vi.fn(),
}));

vi.mock('../../hooks/useAppEventHandlers', () => ({
    useAppEventHandlers: vi.fn(),
}));

// Mock child components
vi.mock('../TransportBar', () => ({
    TransportBar: () => <div data-testid="transport-bar">TransportBar</div>,
}));

vi.mock('../Sidebar', () => ({
    Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock('../MixerPanel', () => ({
    MixerPanel: () => <div data-testid="mixer-panel">Mixer</div>,
}));

vi.mock('../ClipView', () => ({
    ClipView: () => <div data-testid="clip-view">Clip View</div>,
}));

vi.mock('#/modules/Preferences/presentations/views', () => ({
    PreferencesDialog: () => <div data-testid="preferences-dialog">Preferences</div>,
}));

vi.mock('#/modules/AudioEngine/presentations/views', () => ({
    ElasticEditorPanel: elasticEditorPanelMock,
}));

vi.mock('#/modules/AiRuntime/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/presentations/views')>()),
    GenerativeAiPanel: () => <div data-testid="ai-panel">AI Panel</div>,
}));

vi.mock('#/modules/Project/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/presentations/views')>()),
    RecentProjectsMenu: () => <div data-testid="recent-projects">Recent Projects</div>,
}));

vi.mock('#/modules/Collaboration/presentations/views', () => ({
    CollaborationPanel: () => <div data-testid="collab-panel">Collaboration</div>,
    PresenceOverlay: () => <div data-testid="presence-overlay">PresenceOverlay</div>,
}));

vi.mock('#/modules/CrdtDocument/presentations/views', () => ({
    BranchManagerDialog: () => <div data-testid="branch-manager">Branch Manager</div>,
}));

vi.mock('../LaunchScreen', () => ({
    LaunchScreen: ({ exiting }: { exiting: boolean }) => (
        <div data-testid="launch-screen" data-exiting={String(exiting)}>
            Launch Screen
        </div>
    ),
}));

vi.mock('../../components/ProjectLoadingOverlay', () => ({
    ProjectLoadingOverlay: () => <div data-testid="project-loading-overlay">Project Loading</div>,
}));

vi.mock('../../components/AlphaNoticeDialog', () => ({
    AlphaNoticeDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
        if (!open) {
            return null;
        }

        return (
            <div data-testid="alpha-notice-dialog">
                <button type="button" onClick={() => onOpenChange(false)}>
                    Close alpha notice
                </button>
                <button type="button" onClick={() => onOpenChange(true)}>
                    Keep alpha notice open
                </button>
            </div>
        );
    },
}));

vi.mock('../../../useCases/dismissAlphaNotice', () => ({
    dismissAlphaNotice: dismissAlphaNoticeMock,
}));

const mockWorkspaceEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

const mockVoiceToggleEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

const mockNotificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
};

const mockWebMidiEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

type ProjectState = ReturnType<typeof useProjectState>;

const createProjectState = (overrides: Partial<ProjectState> = {}): ProjectState => ({
    name: 'Untitled Project',
    createdAt: 0,
    updatedAt: 0,
    dirty: false,
    loading: false,
    keyRoot: 0,
    scaleName: 'chromatic',
    tuning: {
        name: 'Equal Temperament',
        frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
    },
    initialized: true,
    ...overrides,
});

const createWorkspaceState = (overrides: Partial<WorkspaceState> = {}): WorkspaceState => ({
    ...defaultWorkspaceState,
    inspectorOpen: false,
    mixerOpen: false,
    virtualKeyboardOpen: false,
    ...overrides,
});

const createClip = (type: Clip['type']): Clip => ({
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip 1',
    startBeat: 0,
    endBeat: 4,
    type,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#ffffff',
    locked: false,
    muted: false,
});

const createTrack = (clip: Clip): Track => ({
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
    pan: 0,
    color: '#ffffff',
    clips: [clip],
    devices: [],
    sends: [],
    midiFx: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'off',
    hidden: false,
    disabled: false,
    height: 120,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'main',
    alternatives: [{ id: 'main', name: 'Main', clips: [clip] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
});

let projectState: ProjectState;
let alphaNoticeDismissed: boolean;
let trackStoreState: TrackStoreState;
let selectedClipIdState: string | null;

describe('AppShell', () => {
    beforeEach(() => {
        Container.clear();
        setWorkspaceEventBus(mockWorkspaceEventBus);
        setVoiceToggleEventBus(mockVoiceToggleEventBus);
        setNotificationEventBus(mockNotificationEventBus);
        setWebMidiRuntimeEventBus({ eventBus: mockWebMidiEventBus });
        vi.clearAllMocks();
        workspaceStore.set({ ...defaultWorkspaceState });
        elasticEditorPanelMock.mockImplementation(() => <div data-testid="elastic-panel">Elastic</div>);
        projectState = createProjectState();
        alphaNoticeDismissed = true;
        trackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        selectedClipIdState = null;
        vi.mocked(useProjectState).mockImplementation(() => projectState);
        vi.mocked(useStore).mockImplementation((store, defaultValue) => {
            if (store === trackStore) {
                return trackStoreState;
            }
            if (store === clipSelectionStore) {
                return { selectedClipId: selectedClipIdState, selectedClipIds: [], marqueeSelection: null };
            }
            if (store === aiStore) {
                return { tasks: [], isPanelOpen: false };
            }
            if (store === alphaNoticeStore) {
                return alphaNoticeDismissed;
            }
            return defaultValue || { past: [], future: [] };
        });

        vi.mocked(useWorkspaceState).mockReturnValue(
            createWorkspaceState({
                sidebarOpen: true,
                inspectorOpen: false,
                mixerOpen: false,
                collaborationPanelOpen: false,
                branchManagerOpen: false,
                chatPanelOpen: false,
                sidebarWidth: 200,
                inspectorWidth: 200,
                mixerHeight: 200,
                chatPanelWidth: 200,
                aiPanelWidth: 200,
                virtualKeyboardOpen: false,
            })
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('alpha notice dismissal boundary', () => {
        it('should show initialized projects the alpha notice until dismissed', () => {
            alphaNoticeDismissed = false;

            render(<AppShell>Content</AppShell>);

            expect(screen.getByTestId('alpha-notice-dialog')).toBeInTheDocument();
        });

        it('should hide initialized projects the alpha notice after dismissal state is read', () => {
            alphaNoticeDismissed = true;

            render(<AppShell>Content</AppShell>);

            expect(screen.queryByTestId('alpha-notice-dialog')).not.toBeInTheDocument();
        });

        it('should call dismissAlphaNotice when the alpha notice closes', () => {
            alphaNoticeDismissed = false;

            render(<AppShell>Content</AppShell>);
            fireEvent.click(screen.getByRole('button', { name: 'Close alpha notice' }));

            expect(dismissAlphaNoticeMock).toHaveBeenCalledTimes(1);
        });

        it('should not call dismissAlphaNotice when the alpha notice remains open', () => {
            alphaNoticeDismissed = false;

            render(<AppShell>Content</AppShell>);
            fireEvent.click(screen.getByRole('button', { name: 'Keep alpha notice open' }));

            expect(dismissAlphaNoticeMock).not.toHaveBeenCalled();
        });
    });

    it('should render correctly when project is loaded', () => {
        render(<AppShell>Content</AppShell>);
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('should not render sidebar when closed', () => {
        vi.mocked(useWorkspaceState).mockReturnValue(
            createWorkspaceState({
                sidebarOpen: false,
            })
        );

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
            vi.mocked(useWorkspaceState).mockReturnValue(
                createWorkspaceState({
                    sidebarOpen: false,
                    inspectorOpen: false,
                    mixerOpen: true,
                    collaborationPanelOpen: false,
                    branchManagerOpen: false,
                    chatPanelOpen: false,
                    sidebarWidth: 200,
                    inspectorWidth: 200,
                    mixerHeight: 200,
                    chatPanelWidth: 200,
                    aiPanelWidth: 200,
                    virtualKeyboardOpen: false,
                })
            );
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

        it('should select the editor tab and open the dock when a clip is selected', () => {
            selectedClipIdState = 'clip-1';
            vi.mocked(useWorkspaceState).mockReturnValue(
                createWorkspaceState({
                    sidebarOpen: false,
                    inspectorOpen: false,
                    mixerOpen: false,
                })
            );

            const { rerender } = render(<AppShell>Content</AppShell>);

            expect(workspaceStore.value?.mixerOpen).toBe(true);

            vi.mocked(useWorkspaceState).mockReturnValue(
                createWorkspaceState({
                    sidebarOpen: false,
                    inspectorOpen: false,
                    mixerOpen: true,
                })
            );
            rerender(<AppShell>Content</AppShell>);

            expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByTestId('clip-view')).toBeInTheDocument();
        });

        it('should fall back to the editor tab when the active Elastic tab loses audio clip eligibility', () => {
            selectedClipIdState = 'clip-1';
            trackStoreState = {
                tracks: [createTrack(createClip('audio'))],
                selectedTrackId: 'track-1',
                ghostClips: [],
            };
            vi.mocked(useWorkspaceState).mockReturnValue(
                createWorkspaceState({
                    sidebarOpen: false,
                    inspectorOpen: false,
                    mixerOpen: true,
                })
            );

            const { rerender } = render(<AppShell>Content</AppShell>);
            fireEvent.click(screen.getByTestId('elastic-tab-button'));

            expect(screen.getByRole('tab', { name: 'Elastic' })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByTestId('elastic-panel')).toBeInTheDocument();

            elasticEditorPanelMock.mockClear();
            trackStoreState = {
                tracks: [createTrack(createClip('midi'))],
                selectedTrackId: 'track-1',
                ghostClips: [],
            };
            rerender(<AppShell>Content</AppShell>);

            const editorTab = screen.getByRole('tab', { name: 'Editor' });
            const panel = screen.getByRole('tabpanel');
            expect(screen.queryByTestId('elastic-tab-button')).not.toBeInTheDocument();
            expect(editorTab).toHaveAttribute('aria-selected', 'true');
            expect(panel.getAttribute('aria-labelledby')).toBe(editorTab.id);
            expect(screen.getByTestId('clip-view')).toBeInTheDocument();
            expect(elasticEditorPanelMock).not.toHaveBeenCalled();

            elasticEditorPanelMock.mockClear();
            trackStoreState = {
                tracks: [createTrack(createClip('audio'))],
                selectedTrackId: 'track-1',
                ghostClips: [],
            };
            rerender(<AppShell>Content</AppShell>);

            expect(screen.getByTestId('elastic-tab-button')).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
            expect(screen.queryByTestId('elastic-panel')).not.toBeInTheDocument();
            expect(elasticEditorPanelMock).not.toHaveBeenCalled();
        });
    });

    describe('skip-link resilience (Fix 2)', () => {
        it('renders a skip-link targeting #main-content when no dialog is open', () => {
            render(<AppShell>Content</AppShell>);
            const link = screen.getByText('Skip to content');
            expect(link.getAttribute('href')).toBe('#main-content');
        });

        it('removes the skip-link from the DOM while a modal dialog is open', () => {
            vi.mocked(useWorkspaceState).mockReturnValue(
                createWorkspaceState({
                    sidebarOpen: false,
                    inspectorOpen: false,
                    mixerOpen: false,
                    collaborationPanelOpen: true,
                    branchManagerOpen: false,
                    chatPanelOpen: false,
                    sidebarWidth: 200,
                    inspectorWidth: 200,
                    mixerHeight: 200,
                    chatPanelWidth: 200,
                    aiPanelWidth: 200,
                    virtualKeyboardOpen: false,
                })
            );

            render(<AppShell>Content</AppShell>);
            expect(screen.queryByText('Skip to content')).not.toBeInTheDocument();
        });
    });

    describe('launch overlay state', () => {
        it('should show the loading overlay for returning users without rendering LaunchScreen', () => {
            projectState = createProjectState({ initialized: false, loading: true });

            render(<AppShell>Content</AppShell>);

            expect(screen.getByTestId('project-loading-overlay')).toBeInTheDocument();
            expect(screen.queryByTestId('launch-screen')).not.toBeInTheDocument();
        });

        it('should start the launch exit animation on initialization and unmount after 700 ms', () => {
            vi.useFakeTimers();
            projectState = createProjectState({ initialized: false, loading: false });

            const { rerender } = render(<AppShell>Content</AppShell>);

            expect(screen.getByTestId('launch-screen')).toHaveAttribute('data-exiting', 'false');

            projectState = createProjectState({ initialized: true, loading: false });
            rerender(<AppShell>Content</AppShell>);

            expect(screen.getByTestId('launch-screen')).toHaveAttribute('data-exiting', 'true');

            act(() => {
                vi.advanceTimersByTime(699);
            });
            expect(screen.getByTestId('launch-screen')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(screen.queryByTestId('launch-screen')).not.toBeInTheDocument();
        });
    });
});
