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
import { actionReplayRevisionStore } from '#/modules/Command/stores';
import { setWebMidiRuntimeEventBus } from '#/modules/MIDI/useCases';
import {
    defaultProjectStoreState,
    projectLoadFailureStore,
    type ProjectLoadFailureState,
} from '#/modules/Project/stores';
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

// Every cross-module barrel mock below spreads `importOriginal` first and then
// overrides only the views this shell test actually stubs. An exhaustive factory
// (keys listed by hand, no spread) silently resolves any export added to the
// barrel later to `undefined`, so the next view added to one of these modules
// would red every render here — a failure in WorkspaceShell for a diff that
// never touched it. See #1393.
vi.mock('#/modules/ContentBrowser/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/ContentBrowser/presentations/views')>()),
    Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock('#/modules/MixerConsole/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MixerConsole/presentations/views')>()),
    MixerPanel: () => <div data-testid="mixer-panel">Mixer</div>,
}));

vi.mock('#/modules/TimelineEditor/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/TimelineEditor/presentations/views')>()),
    ClipView: () => <div data-testid="clip-view">Clip View</div>,
    AutomationBottomPanel: () => <div data-testid="automation-panel">Automation</div>,
    InspectorPanel: () => <div data-testid="inspector-panel">Inspector</div>,
}));

vi.mock('#/modules/Preferences/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Preferences/presentations/views')>()),
    PreferencesDialog: () => <div data-testid="preferences-dialog">Preferences</div>,
}));

vi.mock('#/modules/ElasticAudio/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/ElasticAudio/presentations/views')>()),
    ElasticEditorPanel: elasticEditorPanelMock,
}));

vi.mock('#/modules/Routing/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/presentations/views')>()),
    RoutingMatrix: () => <div data-testid="routing-matrix">Routing</div>,
}));

vi.mock('#/modules/SessionLauncher/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/SessionLauncher/presentations/views')>()),
    LoopStationPanel: () => <div data-testid="loop-station-panel">LoopStation</div>,
    SessionView: () => <div data-testid="session-view">Session</div>,
}));

vi.mock('#/modules/Setlist/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Setlist/presentations/views')>()),
    SetlistPanel: () => <div data-testid="setlist-panel">Setlist</div>,
}));

// Spread, like every other barrel in this file. `Metering` is reached twice over
// through the spread-mocked `TimelineEditor` barrel — `MasterVisualizationsSection`
// wants eight of its views and `MixerLevelReadout` wants `LevelMeter` — none of
// which an exhaustive factory here would supply.
vi.mock('#/modules/Metering/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Metering/presentations/views')>()),
    AnalysisPanel: () => <div data-testid="analysis-panel">Analysis</div>,
}));

vi.mock('#/modules/Automation/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/presentations/views')>()),
    ModulationMatrix: () => <div data-testid="modulation-matrix">Modulation</div>,
}));

vi.mock('#/modules/AiRuntime/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/presentations/views')>()),
    GenerativeAiPanel: () => <div data-testid="ai-panel">AI Panel</div>,
}));

vi.mock('#/modules/Project/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/presentations/views')>()),
    RecentProjectsMenu: () => <div data-testid="recent-projects">Recent Projects</div>,
}));

vi.mock('#/modules/Collaboration/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/presentations/views')>()),
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

// The real ones render null when idle, which cannot answer "where in the tree
// are they mounted" — and that placement is the whole point once the shell root
// can go `inert`.
vi.mock('#/infra/dialogService/NotificationToast', () => ({
    NotificationToast: () => <div data-testid="notification-toast">Toast</div>,
}));
vi.mock('#/infra/dialogService/ConfirmDialog', () => ({
    ConfirmDialog: () => <div data-testid="confirm-dialog-host">Confirm</div>,
}));
vi.mock('#/infra/dialogService/PromptDialog', () => ({
    PromptDialog: () => <div data-testid="prompt-dialog-host">Prompt</div>,
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
    on: vi.fn(() => () => {}),
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
    productionBrief: overrides.productionBrief ?? structuredClone(defaultProjectStoreState.productionBrief),
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
let projectLoadFailureState: ProjectLoadFailureState | null;
let alphaNoticeDismissed: boolean;
let trackStoreState: TrackStoreState;
let selectedClipIdState: string | null;
let workspaceState: WorkspaceState;

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
        projectLoadFailureState = null;
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
            if (store === projectLoadFailureStore) {
                return projectLoadFailureState;
            }
            if (store === workspaceStore) {
                return workspaceState;
            }
            return defaultValue;
        });

        workspaceState = createWorkspaceState({
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
        });
        vi.mocked(useWorkspaceState).mockImplementation(() => workspaceState);
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

    it('preserves falsy defaults for unlisted stores', () => {
        expect(useStore(actionReplayRevisionStore, 0)).toBe(0);
    });

    it.each([
        ['undo history', { undoHistoryOpen: true }, 'Undo History'],
        ['command palette', { commandPaletteOpen: true }, 'Command Palette'],
    ] as const)('renders and hides the %s from workspace truth', (_name, openState, accessibleName) => {
        workspaceState = createWorkspaceState(openState);
        const { unmount } = render(<AppShell>Content</AppShell>);
        expect(screen.getByText(accessibleName)).toBeInTheDocument();

        unmount();
        workspaceState = createWorkspaceState();
        render(<AppShell>Content</AppShell>);
        expect(screen.queryByText(accessibleName)).not.toBeInTheDocument();
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

        /**
         * The reason the terminal open failure has its own store rather than
         * riding the transient flags. `launchReady` latches the first time a
         * project opens and is never reset, so mid-session
         * `{ initialized: false, loading: false }` reveals neither the launch
         * screen nor the loading overlay — the user is left in the full editor
         * over whatever the stores now hold.
         */
        it('renders the editor, not the launch screen, when a session ends mid-run', () => {
            vi.useFakeTimers();
            projectState = createProjectState({ initialized: false, loading: false });
            const { rerender } = render(<AppShell>Content</AppShell>);

            // Boot: launch screen, then a project opens and latches `launchReady`.
            expect(screen.getByTestId('launch-screen')).toBeInTheDocument();
            projectState = createProjectState({ initialized: true, loading: false });
            rerender(<AppShell>Content</AppShell>);
            act(() => {
                vi.advanceTimersByTime(700);
            });
            expect(screen.queryByTestId('launch-screen')).not.toBeInTheDocument();

            // Mid-session, back to the cold-start flag values.
            projectState = createProjectState({ initialized: false, loading: false });
            rerender(<AppShell>Content</AppShell>);

            expect(screen.queryByTestId('launch-screen')).not.toBeInTheDocument();
            expect(screen.queryByTestId('project-loading-overlay')).not.toBeInTheDocument();
            // Nothing blocking: the editor chrome is what the user is left with.
            expect(screen.getByTestId('transport-bar')).toBeInTheDocument();
        });

        it('blocks the editor with a failure surface naming the project when an open destroys the session', () => {
            vi.useFakeTimers();
            projectState = createProjectState({ initialized: false, loading: false });
            projectLoadFailureState = {
                message: 'Your previous session was closed to open this project, and the project failed to open.',
                projectName: 'Half Finished Song',
            };

            render(<AppShell>Content</AppShell>);

            const surface = screen.getByRole('alertdialog');
            expect(surface).toHaveTextContent('Half Finished Song');
            // The only recovery, and it is offered rather than described.
            expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
            // It must not auto-dismiss: still there long after a toast would be.
            act(() => {
                vi.advanceTimersByTime(30_000);
            });
            expect(screen.getByRole('alertdialog')).toBeInTheDocument();
        });

        it('moves focus into the failure surface and keeps Tab inside it', () => {
            projectState = createProjectState({ initialized: false, loading: false });
            projectLoadFailureState = {
                message: 'Your previous session was closed to open this project, and the project failed to open.',
                projectName: 'Half Finished Song',
            };

            render(<AppShell>Content</AppShell>);

            // `aria-modal` tells assistive tech to ignore everything outside
            // this node, so focus has to be inside it or a screen-reader user is
            // parked in suppressed content with no route to the only action.
            const reload = screen.getByRole('button', { name: 'Reload' });
            expect(reload).toHaveFocus();

            fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Tab' });
            expect(reload).toHaveFocus();
        });

        it('drops the skip-link from the tab order while the failure surface is up', () => {
            projectState = createProjectState({ initialized: false, loading: false });

            const { rerender } = render(<AppShell>Content</AppShell>);
            // Present with no dialog up — otherwise its absence below proves
            // nothing.
            expect(screen.getByText('Skip to content')).toBeInTheDocument();

            projectLoadFailureState = { message: 'gone', projectName: 'Half Finished Song' };
            rerender(<AppShell>Content</AppShell>);

            // A focused skip-link targeting #main-content would move focus
            // behind the modal, out of its trap.
            expect(screen.queryByText('Skip to content')).not.toBeInTheDocument();
        });

        it('takes the whole shell out of the tab order and the a11y tree behind the failure surface', () => {
            projectState = createProjectState({ initialized: false, loading: false });

            const { rerender } = render(<AppShell>Content</AppShell>);
            // Not inert with no dialog up — otherwise the assertion below is
            // satisfied by an attribute that is simply always there.
            expect(screen.getByTestId('app-shell')).not.toHaveAttribute('inert');

            projectLoadFailureState = { message: 'gone', projectName: 'Half Finished Song' };
            rerender(<AppShell>Content</AppShell>);

            // The dialog's own keydown trap only holds while focus is already
            // inside it; a round trip through browser chrome re-enters at the
            // first focusable node behind the modal. `inert` is what makes
            // `aria-modal="true"` true.
            expect(screen.getByTestId('app-shell')).toHaveAttribute('inert');
            // And the dialog itself must be outside that subtree, or it goes
            // inert with everything else.
            expect(screen.getByTestId('app-shell')).not.toContainElement(screen.getByRole('alertdialog'));
            // So must every channel that still has to reach the user while the
            // shell is inert — `inert` removes a subtree from the accessibility
            // tree, so a `role="alert"` toast inside it is never announced and a
            // pending confirm can never be answered.
            expect(screen.getByTestId('app-shell')).not.toContainElement(screen.getByTestId('notification-toast'));
            expect(screen.getByTestId('app-shell')).not.toContainElement(screen.getByTestId('confirm-dialog-host'));
        });

        it('shows no failure surface on an ordinary load', () => {
            projectState = createProjectState({ initialized: true, loading: false });

            render(<AppShell>Content</AppShell>);

            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        });

        it('keeps the launch overlay exiting when initialized briefly flips back to false', () => {
            vi.useFakeTimers();
            projectState = createProjectState({ initialized: false, loading: false });

            const { rerender } = render(<AppShell>Content</AppShell>);
            expect(screen.getByTestId('launch-screen')).toHaveAttribute('data-exiting', 'false');

            // Project readies -> overlay starts exiting and latches.
            projectState = createProjectState({ initialized: true, loading: false });
            rerender(<AppShell>Content</AppShell>);
            expect(screen.getByTestId('launch-screen')).toHaveAttribute('data-exiting', 'true');

            // A transient store blip re-reports the project as uninitialized
            // (projectStore transient re-hydrate / stale notification under
            // load). The overlay must stay exiting, not re-block — the
            // intermittent template-launch hang this fix targets.
            projectState = createProjectState({ initialized: false, loading: false });
            rerender(<AppShell>Content</AppShell>);
            expect(screen.getByTestId('launch-screen')).toHaveAttribute('data-exiting', 'true');
        });

        it('does not re-reveal the launch screen after it unmounts when the project blips uninitialized', () => {
            vi.useFakeTimers();
            projectState = createProjectState({ initialized: false, loading: false });

            const { rerender } = render(<AppShell>Content</AppShell>);
            projectState = createProjectState({ initialized: true, loading: false });
            rerender(<AppShell>Content</AppShell>);

            act(() => {
                vi.advanceTimersByTime(700);
            });
            expect(screen.queryByTestId('launch-screen')).not.toBeInTheDocument();

            // A late uninitialized blip must not bring the launch screen back.
            projectState = createProjectState({ initialized: false, loading: false });
            rerender(<AppShell>Content</AppShell>);
            expect(screen.queryByTestId('launch-screen')).not.toBeInTheDocument();
        });
    });

    // ── Bottom-dock tab content routing ───────────────────────────────────────────
    describe('bottom-dock tab routing', () => {
        beforeEach(() => {
            vi.mocked(useWorkspaceState).mockReturnValue(
                createWorkspaceState({
                    sidebarOpen: false,
                    inspectorOpen: false,
                    mixerOpen: true,
                })
            );
        });

        const tabCases: Array<[string, string]> = [
            ['Routing', 'routing-matrix'],
            ['Automation', 'automation-panel'],
            ['Session', 'session-view'],
            ['Analysis', 'analysis-panel'],
            ['Setlist', 'setlist-panel'],
            ['Loop Station', 'loop-station-panel'],
            ['Modulation', 'modulation-matrix'],
        ];

        it.each(tabCases)('renders the %s panel when its tab is clicked', (label, testId) => {
            render(<AppShell>Content</AppShell>);
            fireEvent.click(screen.getByRole('tab', { name: label }));
            expect(screen.getByTestId(testId)).toBeInTheDocument();
        });

        it('falls back to the RoutingMatrix for an unknown tab value', () => {
            // The default case in renderBottomTabContent renders RoutingMatrix.
            // We can't easily synthesize an unknown value through the UI, but the
            // routing tab itself exercises the RoutingMatrix branch.
            render(<AppShell>Content</AppShell>);
            fireEvent.click(screen.getByRole('tab', { name: 'Routing' }));
            expect(screen.getByTestId('routing-matrix')).toBeInTheDocument();
        });
    });
});
