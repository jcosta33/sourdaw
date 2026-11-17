import {
    type CSSProperties,
    type ReactElement,
    type ReactNode,
    lazy,
    Suspense,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

import { X } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { DawTabStrip, getDawTabId, type DawTabStripItem } from '#/components/daw/DawTabStrip';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { DragResizeHandle } from '#/components/ui/DragResizeHandle';
import { ConfirmDialog } from '#/infra/dialogService/ConfirmDialog';
import { NotificationToast } from '#/infra/dialogService/NotificationToast';
import { PromptDialog } from '#/infra/dialogService/PromptDialog';
import { useStore } from '#/infra/store/useStore';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { aiStore } from '#/modules/AiGeneration/stores';
import {
    GenerativeAiPanel,
    ChatPanel,
    VoiceCommandOverlay,
    AiChangeToast,
    AiActionHistoryPanel,
    MixAnalysisPanel,
} from '#/modules/AiRuntime/presentations/views';
import { TakeLanesView } from '#/modules/Arrangement/presentations/views';
import { clipSelectionStore, defaultClipSelectionState, trackStore } from '#/modules/Arrangement/stores';
import { detectVariationLaneEnabling } from '#/modules/Arrangement/useCases';
import { ExportDialog } from '#/modules/AudioRendering/presentations/views';
import { ModulationMatrix } from '#/modules/Automation/presentations/views';
import { BacteriaPanel } from '#/modules/Bacteria/presentations/views';
import { UndoHistoryPanel } from '#/modules/Command/presentations/views';
import { CommandPalette, useGlobalKeyboardShortcuts } from '#/modules/CommandInterface/presentations/views';
import { hasOpenModalSurface, isNativeTextEditableTarget } from '#/modules/CommandInterface/useCases';
import { Sidebar, type SidebarPanelActions } from '#/modules/ContentBrowser/presentations/views';
import { CrumbsPanel } from '#/modules/Crumbs/presentations/views';
import { CrustPanel } from '#/modules/Crust/presentations/views';
import { ElasticEditorPanel } from '#/modules/ElasticAudio/presentations/views';
import { FermenterPanel } from '#/modules/Fermenter/presentations/views';
import { GlutenPanel } from '#/modules/Gluten/presentations/views';
import { GrandBoulePanel } from '#/modules/GrandBoule/presentations/views';
import { GrinderPanel } from '#/modules/Grinder/presentations/views';
import { LevainPanel } from '#/modules/Levain/presentations/views';
import { AnalysisPanel } from '#/modules/Metering/presentations/views';
import { MixerPanel } from '#/modules/MixerConsole/presentations/views';
import { OnboardingTour } from '#/modules/Onboarding/presentations/views';
import { defaultOnboardingState, onboardingStore } from '#/modules/Onboarding/stores';
import { isOnboardingCompleted, startOnboardingTour } from '#/modules/Onboarding/useCases';
import { type PreferencesSection } from '#/modules/Preferences/events';
import { PreferencesDialog } from '#/modules/Preferences/presentations/views';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { repairProjectData, unlockProjectScopedBrief } from '#/modules/Project/useCases';
import { ProofPanel } from '#/modules/Proof/presentations/views';
import { ProofChamberPanel } from '#/modules/ProofChamber/presentations/views';
import { RoutingMatrix } from '#/modules/Routing/presentations/views';
import { LoopStationPanel, SessionView } from '#/modules/SessionLauncher/presentations/views';
import { SetlistPanel } from '#/modules/Setlist/presentations/views';
import {
    AutomationBottomPanel,
    ClipView,
    InspectorPanel,
    useArrangementMinimumHeight,
} from '#/modules/TimelineEditor/presentations/views';
import { ToasterPanel } from '#/modules/Toaster/presentations/views';
import { TunerPanel } from '#/modules/Tuner/presentations/views';
import { YeastPanel } from '#/modules/Yeast/presentations/views';
import {
    allocateMainFirstWidths,
    MIN_ARRANGE_COLUMN_WIDTH,
    SHELL_RESIZE_HANDLE_WIDTH,
} from '#/utils/Layout/allocateMainFirstWidths';
import {
    INSPECTOR_WIDTH_BOUNDS,
    SIDEBAR_WIDTH_BOUNDS,
    VIRTUAL_KEYBOARD_HEIGHT_BOUNDS,
} from '#/utils/Layout/panelDimensionBounds';
import { clamp } from '#/utils/Math/clamp';

import { alphaNoticeStore } from '../../stores/alphaNoticeStore';
import { dismissAlphaNotice } from '../../useCases/dismissAlphaNotice';
import { onShowDevicePanel } from '../../useCases/panels/devicePanels/onShowDevicePanel';
import { showDevicePanel } from '../../useCases/panels/devicePanels/showDevicePanel';
import { revealDeviceInInspector } from '../../useCases/panels/revealDeviceInInspector';
import { closeBranchManager } from '../../useCases/togglePanel/panelToggles/closeBranchManager';
import { openMixer } from '../../useCases/togglePanel/panelToggles/openMixer';
import { toggleMixer } from '../../useCases/togglePanel/panelToggles/toggleMixer';
import { toggleSidebar } from '../../useCases/togglePanel/panelToggles/toggleSidebar';
import { toggleVirtualKeyboard } from '../../useCases/togglePanel/panelToggles/toggleVirtualKeyboard';
import { updateWorkspaceState } from '../../useCases/workspaceState';
import { AlphaNoticeDialog } from '../components/AlphaNoticeDialog';
import { EngineFallbackNotice } from '../components/EngineFallbackNotice';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { FloatingDevicePanel, type DevicePanelGeometry } from '../components/FloatingDevicePanel';
import { ProjectLoadFailureOverlay } from '../components/ProjectLoadFailureOverlay';
import { ProjectLoadingOverlay } from '../components/ProjectLoadingOverlay';
import { ProjectMutationRefusedBanner } from '../components/ProjectMutationRefusedBanner';
import { useActiveDevicePanel, type ActiveDevicePanel } from '../hooks/useActiveDevicePanel';
import { useAppEventHandlers } from '../hooks/useAppEventHandlers';
import { useAppInitialization } from '../hooks/useAppInitialization';
import { useEngineFallbackNotice } from '../hooks/useEngineFallbackNotice';
import { useNativeApplicationMenu } from '../hooks/useNativeApplicationMenu';
import { useProjectLoadFailure } from '../hooks/useProjectLoadFailure';
import { useProjectMutationRefusal } from '../hooks/useProjectMutationRefusal';
import { useProjectState } from '../hooks/useProjectState';
import { useShellTrackFacts } from '../hooks/useShellTrackFacts';
import { useWorkspaceState } from '../hooks/useWorkspaceState';

import { AgentWorkspace } from './AgentWorkspace';
import { LaunchScreen } from './LaunchScreen';
import { ConnectedLlmStatusBadge } from './Prompt/ConnectedLlmStatusBadge';
import { ShortcutHelp } from './ShortcutHelp';
import { StatusBar } from './StatusBar';
import { TransportBar } from './TransportBar';
import { VirtualKeyboard } from './VirtualKeyboard';

// Device-panel emitters injected into the ContentBrowser Sidebar. The panel
// system is owned by Workspace; the browser only triggers it, so these stable
// singletons are passed in as callbacks (module-level — no per-render alloc).
// Each callback rides the single generic `panel.showDevice` event, naming the
// device type the browser button stands for.
const SIDEBAR_PANEL_ACTIONS: SidebarPanelActions = {
    showBacteria: (deviceId) => showDevicePanel('bacteria', deviceId),
    showCrust: (deviceId) => showDevicePanel('crust', deviceId),
    showDevice: showDevicePanel,
    showDutchOven: (deviceId) => showDevicePanel('dutch-oven', deviceId),
    showGluten: (deviceId) => showDevicePanel('gluten', deviceId),
    showProof: (deviceId) => showDevicePanel('proof', deviceId),
    showScoring: (deviceId) => showDevicePanel('native-scoring', deviceId),
    showYeast: (deviceId) => showDevicePanel('yeast', deviceId),
    showCrumbs: (deviceId) => showDevicePanel('builtin-crumbs', deviceId),
    showFermenter: (deviceId) => showDevicePanel('fermenter', deviceId),
    showGrandBoule: (deviceId) => showDevicePanel('grand-boule', deviceId),
    showLevain: (deviceId) => showDevicePanel('levain', deviceId),
    showToaster: (deviceId) => showDevicePanel('toaster', deviceId),
    revealDevice: revealDeviceInInspector,
};
const CollaborationPanelLazy = lazy(() =>
    import('#/modules/Collaboration/presentations/views').then((m) => ({
        default: m.CollaborationPanel,
    }))
);

const BranchManagerDialogLazy = lazy(() =>
    import('#/modules/CrdtDocument/presentations/views').then((m) => ({
        default: m.BranchManagerDialog,
    }))
);

// Panel-shaped placeholder shown while a lazily-loaded panel chunk is still in
// flight. A blank `fallback={null}` left the screen empty for 1s+ on slow
// networks; this gives an animated, dialog-positioned skeleton so the user sees
// that something is loading rather than nothing.
const LazyPanelFallback = (): ReactElement => (
    <Row
        justify="center"
        className="fixed inset-0 z-40 bg-black/40"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid="lazy-panel-fallback"
    >
        <Stack gap={3} className="rounded-md bg-surface-raised p-4 shadow-lg">
            <div className="h-4 w-40 animate-pulse rounded bg-surface-base" />
            <div className="h-32 w-72 animate-pulse rounded bg-surface-base" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-base" />
        </Stack>
        <span className="sr-only">Loading…</span>
    </Row>
);

const DEVICE_ACCENTS = {
    lavender: {
        labelColor: 'text-[var(--color-accent-lavender)]',
        borderColor: 'border-[var(--color-accent-lavender)]/20',
    },
    peach: { labelColor: 'text-[var(--color-accent-peach)]', borderColor: 'border-[var(--color-accent-peach)]/20' },
    amber: { labelColor: 'text-[var(--color-accent-amber)]', borderColor: 'border-[var(--color-accent-amber)]/20' },
    cyan: { labelColor: 'text-[var(--color-accent-cyan)]', borderColor: 'border-[var(--color-accent-cyan)]/20' },
    rose: { labelColor: 'text-[var(--color-accent-rose)]', borderColor: 'border-[var(--color-accent-rose)]/20' },
    copper: { labelColor: 'text-[var(--color-accent-copper)]', borderColor: 'border-[var(--color-accent-copper)]/20' },
    mint: { labelColor: 'text-[var(--color-accent-mint)]', borderColor: 'border-[var(--color-accent-mint)]/20' },
};

const DEVICE_EDITORS = {
    fermenter: {
        label: 'Fermenter',
        accent: DEVICE_ACCENTS.lavender,
        render: (id: string) => <FermenterPanel deviceId={id} />,
    },
    toaster: { label: 'Toaster', accent: DEVICE_ACCENTS.peach, render: (id: string) => <ToasterPanel deviceId={id} /> },
    levain: { label: 'Levain', accent: DEVICE_ACCENTS.amber, render: (id: string) => <LevainPanel deviceId={id} /> },
    proofChamber: {
        label: 'Dutch Oven',
        accent: DEVICE_ACCENTS.cyan,
        render: (id: string) => <ProofChamberPanel deviceId={id} />,
    },
    gluten: { label: 'Gluten', accent: DEVICE_ACCENTS.peach, render: (id: string) => <GlutenPanel deviceId={id} /> },
    bacteria: {
        label: 'Bacteria',
        accent: DEVICE_ACCENTS.rose,
        render: (id: string) => <BacteriaPanel deviceId={id} />,
    },
    grinder: {
        label: 'Grinder',
        accent: DEVICE_ACCENTS.copper,
        render: (id: string) => <GrinderPanel deviceId={id} />,
    },
    proof: { label: 'Proof', accent: DEVICE_ACCENTS.mint, render: (id: string) => <ProofPanel deviceId={id} /> },
    scoring: { label: 'Scoring', accent: DEVICE_ACCENTS.mint, render: (id: string) => <TunerPanel deviceId={id} /> },
    yeast: {
        label: 'Yeast',
        accent: DEVICE_ACCENTS.peach,
        render: (id: string | null) => <YeastPanel deviceId={id} />,
    },
    crust: { label: 'Crust', accent: DEVICE_ACCENTS.cyan, render: (id: string) => <CrustPanel deviceId={id} /> },
    sampler: { label: 'Sampler', accent: DEVICE_ACCENTS.peach, render: (id: string) => <CrumbsPanel deviceId={id} /> },
    grandBoule: {
        label: 'Grand Boule',
        accent: DEVICE_ACCENTS.amber,
        render: (id: string) => <GrandBoulePanel deviceId={id} />,
    },
};

function otherSurfaceOwnsDevicePanelEscape(dialog: Element | null, target: EventTarget | null): boolean {
    return (
        hasOpenModalSurface(dialog) ||
        (target instanceof Element &&
            (isNativeTextEditableTarget(target) ||
                target.closest('select, [role="listbox"], [aria-expanded="true"][aria-haspopup]') !== null))
    );
}

function ActiveDeviceEditor({
    panel,
    onClose,
}: {
    panel: ActiveDevicePanel | null;
    onClose: () => void;
}): ReactElement | null {
    const [geometry, setGeometry] = useState<DevicePanelGeometry | null>(null);
    if (panel === null) {
        return null;
    }
    const { label, accent, render } = DEVICE_EDITORS[panel.kind];
    return (
        <FloatingDevicePanel
            key={JSON.stringify([panel.kind, panel.deviceId, panel.trackId])}
            label={label}
            {...accent}
            otherSurfaceOwnsEscape={otherSurfaceOwnsDevicePanelEscape}
            geometry={geometry}
            setGeometry={setGeometry}
            onClose={onClose}
        >
            <ErrorBoundary variant="inline">
                {panel.kind === 'yeast' ? DEVICE_EDITORS.yeast.render(panel.deviceId) : render(panel.deviceId)}
            </ErrorBoundary>
        </FloatingDevicePanel>
    );
}

type AppShellProps = {
    children: ReactNode;
};

type BottomTabValue =
    | 'editor'
    | 'mixer'
    | 'session'
    | 'routing'
    | 'analysis'
    | 'automation'
    | 'setlist'
    | 'loopStation'
    | 'modulation'
    | 'elastic'
    | 'takes'
    | 'agent';

type BottomTabState = {
    value: BottomTabValue;
    selectedClipId: string | null;
};

// The dock tabs in display order. Elastic and Takes are conditional; see `isBottomTabVisible`.
const BOTTOM_TABS: readonly DawTabStripItem<BottomTabValue>[] = [
    { id: 'mixer', label: 'Mixer', activeClassName: 'text-primary' },
    { id: 'editor', label: 'Editor', activeClassName: 'text-[var(--color-accent-cyan)]' },
    { id: 'automation', label: 'Automation', activeClassName: 'text-[var(--color-accent-lavender)]' },
    { id: 'session', label: 'Session', activeClassName: 'text-[var(--color-accent-mint)]' },
    { id: 'routing', label: 'Routing', activeClassName: 'text-[var(--color-accent-peach)]' },
    { id: 'analysis', label: 'Analysis', activeClassName: 'text-[var(--color-accent-lavender)]' },
    {
        id: 'setlist',
        label: 'Setlist',
        activeClassName: 'text-[var(--color-accent-amber)]',
        attributes: { 'data-onboarding': 'setlist-tab' },
    },
    {
        id: 'loopStation',
        label: 'Loop Station',
        activeClassName: 'text-[var(--color-accent-mint)]',
        attributes: { 'data-onboarding': 'loop-station-tab' },
    },
    {
        id: 'modulation',
        label: 'Modulation',
        activeClassName: 'text-[var(--color-accent-cyan)]',
        attributes: { 'data-onboarding': 'modulation-tab' },
    },
    {
        id: 'agent',
        label: 'Agent',
        activeClassName: 'text-[var(--color-accent-mint)]',
        attributes: { 'data-testid': 'agent-tab-button' },
    },
    {
        id: 'elastic',
        label: 'Elastic',
        activeClassName: 'text-[var(--color-accent-peach)]',
        attributes: { 'data-testid': 'elastic-tab-button' },
    },
    {
        id: 'takes',
        label: 'Takes',
        activeClassName: 'text-[var(--color-accent-mint)]',
        attributes: { 'data-testid': 'takes-tab-button' },
    },
];
const BOTTOM_TAB_ID_PREFIX = 'bottom-dock-tab';
const BOTTOM_TABPANEL_ID = 'bottom-dock-tabpanel';

const EDITOR_MIN_HEIGHT = 280;
const MIXER_MIN_HEIGHT = 120;
// Outlasts LaunchScreen's 650 ms exit fade.
const LAUNCH_EXIT_UNMOUNT_MS = 700;

/**
 * Under reduced motion the launch overlay drops its exit transition, so it is
 * unmounted at once rather than left as a transparent aria-modal dialog.
 */
function launchExitUnmountDelayMs(): number {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : LAUNCH_EXIT_UNMOUNT_MS;
}

/**
 * The shell proper. `MobileGate` sits *above* this component, in the root route, so on
 * a sub-768px viewport AppShell never mounts and none of the effects below run: no
 * engine init, no project load, no MIDI start, no synth/effect registration and no
 * autosave interval, on a platform the app declares unsupported. Do not reintroduce
 * the gate inside this component — hooks cannot be conditional, so a gate here mounts
 * everything anyway and only swaps the rendered output.
 */
export const AppShell = ({ children }: AppShellProps): ReactElement => {
    const workspaceState = useWorkspaceState();
    const arrangementMinimumHeight = useArrangementMinimumHeight();
    const {
        sidebarOpen,
        inspectorOpen,
        mixerOpen,
        collaborationPanelOpen,
        branchManagerOpen,
        commandPaletteOpen,
        chatPanelOpen,
        sidebarWidth,
        inspectorWidth,
        mixerHeight,
        editorHeight = 360,
        chatPanelWidth: chatWidth,
        aiPanelWidth: aiWidth,
        virtualKeyboardOpen,
        virtualKeyboardHeight,
    } = workspaceState;
    const selectedClipId = useStore(clipSelectionStore, defaultClipSelectionState).selectedClipId;

    const project = useProjectState();
    const projectLoadFailure = useProjectLoadFailure();
    const projectMutationRefusal = useProjectMutationRefusal();
    const { showNotice: showEngineFallbackNotice, dismissNotice: dismissEngineFallbackNotice } =
        useEngineFallbackNotice();
    const prefs = useStore(preferencesStore, defaultPreferences);
    const { isAudioClipSelected, takesTabAvailable, variationLanesShown } = useShellTrackFacts(selectedClipId);
    const aiPanelOpen = useStoreSelector(aiStore, (state) => state?.isPanelOpen ?? false);
    const alphaDismissed = useStore(alphaNoticeStore);
    const showAlphaNotice = project.initialized && !alphaDismissed;
    const [exportOpen, setExportOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [prefsSection, setPrefsSection] = useState<PreferencesSection | undefined>(undefined);
    const [bottomTabState, setBottomTabState] = useState<BottomTabState>({ value: 'mixer', selectedClipId: null });
    const selectedClipChanged = bottomTabState.selectedClipId !== selectedClipId;
    const selectedClipBottomTab = selectedClipChanged && selectedClipId !== null ? 'editor' : bottomTabState.value;
    const elasticBottomTabUnavailable = selectedClipBottomTab === 'elastic' && !isAudioClipSelected;
    const takesBottomTabUnavailable = selectedClipBottomTab === 'takes' && !takesTabAvailable;
    let bottomTab: BottomTabValue = selectedClipBottomTab;
    if (elasticBottomTabUnavailable) {
        bottomTab = 'editor';
    } else if (takesBottomTabUnavailable) {
        bottomTab = 'mixer';
    }

    if (selectedClipChanged || elasticBottomTabUnavailable || takesBottomTabUnavailable) {
        setBottomTabState({
            value: bottomTab,
            selectedClipId,
        });
    }

    const setBottomTab = (value: BottomTabValue): void => {
        setBottomTabState({ value, selectedClipId });
    };
    const activeBottomTab = bottomTab;
    const [requestedAgentRun, setRequestedAgentRun] = useState<{ runId: string } | null>(null);
    const reviewAgentRun = (runId: string): void => {
        setRequestedAgentRun({ runId });
        setBottomTab('agent');
        updateWorkspaceState({ mixerOpen: true });
    };

    // The cheat sheet owns its own '?' keydown toggle and is a leaf component, so it
    // cannot be read out of workspace state; it reports its open state up instead.
    const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
    const [shellViewportWidth, setShellViewportWidth] = useState(() => window.innerWidth);
    useLayoutEffect(() => {
        const sync = (): void => {
            setShellViewportWidth(window.innerWidth);
        };
        window.addEventListener('resize', sync);
        sync();
        return () => window.removeEventListener('resize', sync);
    }, []);

    // The onboarding tour is a full-screen aria-modal overlay that owns its own
    // state; read it here so the skip-link can be suppressed while it is up.
    const onboarding = useStore(onboardingStore, defaultOnboardingState);

    const { activePanel, closeActivePanel } = useActiveDevicePanel();

    // ─── Extracted hooks ───
    // §10.2 item 1 — Keyboard shortcuts are now unified under
    // `useGlobalKeyboardShortcuts` / `Command/stores/shortcutStore`. The
    // dialog-open shortcuts dispatch `openExportDialog()` /
    // `openPreferencesDialog()` which emit `dialog.*` events consumed by
    // `useAppEventHandlers` below — that's the single source of truth for
    // flipping these dialogs open.
    useAppInitialization();
    useGlobalKeyboardShortcuts();
    useNativeApplicationMenu(project);

    useAppEventHandlers({
        onOpenExport: () => setExportOpen(true),
        onOpenPreferences: (request) => {
            setPrefsSection(request?.section);
            setPrefsOpen(true);
        },
    });

    useEffect(() => {
        if (!project.initialized) {
            return undefined;
        }
        if (!alphaDismissed) {
            return undefined;
        }
        if (isOnboardingCompleted()) {
            return undefined;
        }
        const triggerIfReady = (): boolean => {
            const trackCount = trackStore.value?.tracks.length ?? 0;
            if (trackCount === 0) {
                return false;
            }
            startOnboardingTour();
            return true;
        };
        if (triggerIfReady()) {
            return undefined;
        }
        const unsubscribe = trackStore.subscribe(() => {
            if (isOnboardingCompleted()) {
                unsubscribe();
                return;
            }
            if (triggerIfReady()) {
                unsubscribe();
            }
        });
        return () => {
            unsubscribe();
        };
    }, [project.initialized, alphaDismissed]);

    // Switching a track's variation lanes on reveals the take panel, which lives
    // in the Takes tab. It acts on that edge only: a project loading with lanes
    // already on, or lanes switching off, must not move the dock, and the user
    // can leave the tab while lanes stay on. The first observation only seeds
    // the comparison.
    const variationLanesShownRef = useRef<ReadonlyMap<string, boolean> | null>(null);
    useEffect(() => {
        const { shown, enabledTrackIds } = detectVariationLaneEnabling(
            variationLanesShownRef.current,
            trackStore.value?.tracks ?? []
        );
        variationLanesShownRef.current = shown;
        if (enabledTrackIds.length === 0) {
            return;
        }
        setBottomTabState({ value: 'takes', selectedClipId });
        openMixer();
    }, [variationLanesShown, selectedClipId]);

    // Auto-switch bottom tab when clip selected
    useEffect(() => {
        if (selectedClipId) {
            openMixer();
        }
    }, [selectedClipId]);

    // Listen for automation tab activation (from 'A' key). Automation is not a
    // device panel — it rides the same generic `panel.showDevice` event, and
    // this subscriber is the only consumer of its `automation` device type.
    useEffect(() => {
        return onShowDevicePanel(({ deviceType }) => {
            if (deviceType !== 'automation') {
                return;
            }
            setBottomTabState({ value: 'automation', selectedClipId });
            if (!mixerOpen) {
                openMixer();
            }
        });
    }, [mixerOpen, selectedClipId]);

    // ─── Panel dimension setters (persisted via workspace store) ───
    type DimKey =
        'sidebarWidth' | 'inspectorWidth' | 'chatPanelWidth' | 'aiPanelWidth' | 'mixerHeight' | 'editorHeight';
    const makeDimSetter = (key: DimKey, current: number) => (fn: (prev: number) => number) =>
        updateWorkspaceState({ [key]: fn(current) });

    const setSidebarWidth = makeDimSetter('sidebarWidth', sidebarWidth);
    const setInspectorWidth = makeDimSetter('inspectorWidth', inspectorWidth);
    const setChatWidth = makeDimSetter('chatPanelWidth', chatWidth);
    const setAiWidth = makeDimSetter('aiPanelWidth', aiWidth);
    const setMixerHeight = makeDimSetter('mixerHeight', mixerHeight);
    const setEditorHeight = makeDimSetter('editorHeight', editorHeight);

    // §47.3 — Sidebar / Inspector / Chat / Ai panels render symmetrically on
    // both sides of the main content. Prior to this helper, each panel was
    // rendered twice (~80 lines of near-identical JSX) with only the handle
    // side and the border direction differing.
    type SidePanelResize = {
        label: string;
        value: number;
        min: number;
        max: number;
        onResize: (d: number) => void;
        onSetSize: (size: number) => void;
    };
    const renderSidePanel = (
        open: boolean,
        placement: 'left' | 'right',
        side: 'left' | 'right',
        panel: ReactNode,
        resize: SidePanelResize
    ): ReactNode => {
        if (!open || placement !== side) {
            return null;
        }
        const handle = (
            <DragResizeHandle
                side={side === 'left' ? 'right' : 'left'}
                onResize={resize.onResize}
                onSetSize={resize.onSetSize}
                aria-label={resize.label}
                aria-valuenow={resize.value}
                aria-valuemin={resize.min}
                aria-valuemax={resize.max}
            />
        );
        return side === 'left' ? (
            <>
                {panel}
                {handle}
            </>
        ) : (
            <>
                {handle}
                {panel}
            </>
        );
    };

    type ShellSideId = 'sidebar' | 'inspector' | 'chat' | 'ai';
    const shellSides: { id: ShellSideId; preferred: number; min: number }[] = [];
    if (sidebarOpen) {
        shellSides.push({ id: 'sidebar', preferred: sidebarWidth, min: SIDEBAR_WIDTH_BOUNDS.min });
    }
    if (inspectorOpen) {
        shellSides.push({ id: 'inspector', preferred: inspectorWidth, min: INSPECTOR_WIDTH_BOUNDS.min });
    }
    if (chatPanelOpen) {
        shellSides.push({ id: 'chat', preferred: chatWidth, min: 200 });
    }
    if (aiPanelOpen) {
        shellSides.push({ id: 'ai', preferred: aiWidth, min: 200 });
    }
    const shellAllocated = allocateMainFirstWidths({
        available: shellViewportWidth - shellSides.length * SHELL_RESIZE_HANDLE_WIDTH,
        minMain: MIN_ARRANGE_COLUMN_WIDTH,
        sides: shellSides,
    });
    const allocatedShellWidth = (id: ShellSideId, fallback: number): number => {
        const index = shellSides.findIndex((side) => side.id === id);
        if (index < 0) {
            return fallback;
        }
        return shellAllocated.sides[index] ?? fallback;
    };
    const shellSlotStyle = (displayed: number, preferred: number, comfortMin: number): CSSProperties => {
        const squeezed = displayed < preferred || displayed < comfortMin;
        return {
            width: displayed,
            minWidth: squeezed ? displayed : comfortMin,
        };
    };
    const displayedSidebarWidth = allocatedShellWidth('sidebar', sidebarWidth);
    const displayedInspectorWidth = allocatedShellWidth('inspector', inspectorWidth);
    const displayedChatWidth = allocatedShellWidth('chat', chatWidth);
    const displayedAiWidth = allocatedShellWidth('ai', aiWidth);

    const sidebarNode = (
        <Sidebar
            style={shellSlotStyle(displayedSidebarWidth, sidebarWidth, SIDEBAR_WIDTH_BOUNDS.min)}
            onClose={toggleSidebar}
            panelActions={SIDEBAR_PANEL_ACTIONS}
        />
    );
    const inspectorNode = (
        <InspectorPanel style={shellSlotStyle(displayedInspectorWidth, inspectorWidth, INSPECTOR_WIDTH_BOUNDS.min)} />
    );
    const chatNode = (
        <ChatPanel
            style={shellSlotStyle(displayedChatWidth, chatWidth, 200)}
            routeBadge={<ConnectedLlmStatusBadge />}
        />
    );
    const aiNode = (side: 'left' | 'right'): ReactNode => (
        <div
            className={`flex flex-col ${
                side === 'left' ? 'border-r' : 'border-l'
            } border-border-hairline bg-surface-tray overflow-hidden`}
            style={shellSlotStyle(displayedAiWidth, aiWidth, 200)}
        >
            <GenerativeAiPanel />
        </div>
    );
    const sidebarResize: SidePanelResize = {
        label: 'Resize sidebar',
        value: displayedSidebarWidth,
        min: SIDEBAR_WIDTH_BOUNDS.min,
        max: SIDEBAR_WIDTH_BOUNDS.max,
        onResize: (d) => setSidebarWidth((w) => clamp(w + d, SIDEBAR_WIDTH_BOUNDS.min, SIDEBAR_WIDTH_BOUNDS.max)),
        onSetSize: (size) => setSidebarWidth(() => clamp(size, SIDEBAR_WIDTH_BOUNDS.min, SIDEBAR_WIDTH_BOUNDS.max)),
    };
    const inspectorResize: SidePanelResize = {
        label: 'Resize inspector',
        value: displayedInspectorWidth,
        min: INSPECTOR_WIDTH_BOUNDS.min,
        max: INSPECTOR_WIDTH_BOUNDS.max,
        onResize: (d) => setInspectorWidth((w) => clamp(w + d, INSPECTOR_WIDTH_BOUNDS.min, INSPECTOR_WIDTH_BOUNDS.max)),
        onSetSize: (size) =>
            setInspectorWidth(() => clamp(size, INSPECTOR_WIDTH_BOUNDS.min, INSPECTOR_WIDTH_BOUNDS.max)),
    };
    const chatResize: SidePanelResize = {
        label: 'Resize chat panel',
        value: displayedChatWidth,
        min: 200,
        max: 600,
        onResize: (d) => setChatWidth((w) => clamp(w + d, 200, 600)),
        onSetSize: (size) => setChatWidth(() => clamp(size, 200, 600)),
    };
    const aiResize: SidePanelResize = {
        label: 'Resize AI panel',
        value: displayedAiWidth,
        min: 200,
        max: 500,
        onResize: (d) => setAiWidth((w) => clamp(w + d, 200, 500)),
        onSetSize: (size) => setAiWidth(() => clamp(size, 200, 500)),
    };

    // ─── Launch screen overlay state ───────────────────────────────────────
    // We start hidden (loading:true is the default). New-user loading completion
    // shows the launch screen; initialization derives the exit animation and the
    // existing timer unmounts it after the fade (at once under reduced motion).
    const [showLaunch, setShowLaunch] = useState(false);
    // The launch-overlay exit must be MONOTONIC. `project.initialized` is a
    // transient projectStore flag (stripped from the CRDT, reconstructed on
    // every re-hydrate the projection bridge fires as a template loads); under
    // load a template can finish loading — tracks and devices all live behind
    // the overlay — yet the overlay stays wedged because `initialized`
    // momentarily reads false again, or a store notification lands stale. The
    // old `showLaunch && initialized && !loading` derivation let that single
    // blip re-block the launch screen forever (intermittent template-launch
    // hang under load). Latch "ready" the first time the project is ready under
    // the launch screen so a later blip cannot un-exit it, and never re-reveal
    // the launch screen once a project has been readied.
    const [launchReady, setLaunchReady] = useState(false);
    const projectReady = project.initialized && !project.loading;
    const launchExiting = showLaunch && launchReady;

    // The `!launchReady` guard makes the launch screen strictly BOOT-ONLY: it is
    // revealed once per session and never again. That matches today's product —
    // there is no close-project / return-to-launch flow, so `initialized: false`
    // only ever appears in the store defaults (cold start) or as the transient
    // mid-load blip this latch is here to absorb. If a future "close project ->
    // launch screen" feature lands, it must reset `launchReady` (setLaunchReady(false))
    // wherever it re-reveals the launch screen, or this guard will suppress it.
    if (!project.initialized && !project.loading && !showLaunch && !launchReady) {
        setShowLaunch(true);
    }
    if (showLaunch && projectReady && !launchReady) {
        setLaunchReady(true);
    }

    // True whenever a modal dialog/overlay covers the app. Used to neutralize the
    // skip-link: a focused skip-link targeting #main-content while an overlay is up
    // moves focus behind it, into content `aria-modal="true"` has told AT does not
    // exist. The set is every overlay that *covers the app*, not only the ones that
    // trap focus — the untrapped ones are the dangerous ones, and the trapped ones
    // (CommandPalette is a Radix Dialog with a real FocusScope) cost nothing to
    // include and keep the rule simple. `showLaunch` matters most: it is up on every
    // cold start for a new user, which makes it the app's most common state.
    // UndoHistoryPanel is deliberately absent: it is a non-modal, absolutely
    // positioned utility panel that does not cover the app, so removing the
    // skip-link there would only cost a landmark jump. Declared here, below
    // `showLaunch`, because it reads it.
    const anyDialogOpen =
        exportOpen ||
        prefsOpen ||
        showAlphaNotice ||
        collaborationPanelOpen ||
        branchManagerOpen ||
        commandPaletteOpen ||
        cheatSheetOpen ||
        showLaunch ||
        onboarding.active ||
        projectLoadFailure !== null;

    useEffect(() => {
        if (!launchExiting) {
            return undefined;
        }
        const timer = setTimeout(() => {
            setShowLaunch(false);
        }, launchExitUnmountDelayMs());
        return () => clearTimeout(timer);
    }, [launchExiting]);

    const isBottomTabVisible = (value: BottomTabValue): boolean => {
        if (value === 'elastic') {
            return isAudioClipSelected;
        }
        if (value === 'takes') {
            return takesTabAvailable;
        }
        return true;
    };
    const visibleBottomTabs = BOTTOM_TABS.filter((tab) => isBottomTabVisible(tab.id));

    // Bottom-dock tab content. `routing` renders the same RoutingMatrix branch
    // the original ternary chain used for its final fallback.
    const renderBottomTabContent = (): ReactNode => {
        switch (activeBottomTab) {
            case 'editor':
                return <ClipView />;
            case 'mixer':
                return <MixerPanel style={{ height: '100%' }} />;
            case 'routing':
                return <RoutingMatrix />;
            case 'automation':
                return <AutomationBottomPanel />;
            case 'session':
                return <SessionView />;
            case 'analysis':
                return <AnalysisPanel />;
            case 'setlist':
                return <SetlistPanel />;
            case 'loopStation':
                return <LoopStationPanel />;
            case 'modulation':
                return <ModulationMatrix />;
            case 'elastic':
                return <ElasticEditorPanel />;
            case 'takes':
                return <TakeLanesView />;
            case 'agent':
                return <AgentWorkspace requestedRun={requestedAgentRun} />;
            default:
                return <RoutingMatrix />;
        }
    };

    return (
        <>
            <Stack
                className="h-full w-full overflow-hidden bg-surface-app"
                data-testid="app-shell"
                inert={projectLoadFailure !== null || cheatSheetOpen || onboarding.active}
            >
                {/* Skip-link is removed from the DOM while a modal dialog is open:
                    a focused skip-link targeting #main-content would otherwise
                    scroll focus behind the modal, escaping its focus trap. */}
                {anyDialogOpen ? null : (
                    <a
                        href="#main-content"
                        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
                    >
                        Skip to content
                    </a>
                )}
                <TransportBar onReviewRun={reviewAgentRun} />

                {/* Non-modal on purpose: it explains a refusal, and every route out
                    of one — the assistant panel, the production brief, undo —
                    lives in the workspace it sits above. It is deliberately absent
                    from `anyDialogOpen` and from the `inert` set. */}
                {project.initialized && projectMutationRefusal !== null ? (
                    <ProjectMutationRefusedBanner
                        refusal={projectMutationRefusal}
                        onRepair={repairProjectData}
                        onUnlock={unlockProjectScopedBrief}
                    />
                ) : null}

                {/* Whole-engine failure, not a per-device problem: mounted once at
                    the shell (issue #3871) and non-modal like the refusal banner —
                    the silent workspace it explains stays usable. */}
                {showEngineFallbackNotice ? <EngineFallbackNotice onDismiss={dismissEngineFallbackNotice} /> : null}

                {/* ─── Main horizontal layout ─── */}
                <Row align="stretch" grow className="relative overflow-hidden">
                    {/* Left dynamically placed panels */}
                    {renderSidePanel(sidebarOpen, prefs.panelPlacementSidebar, 'left', sidebarNode, sidebarResize)}
                    {renderSidePanel(
                        inspectorOpen,
                        prefs.panelPlacementInspector,
                        'left',
                        inspectorNode,
                        inspectorResize
                    )}
                    {renderSidePanel(chatPanelOpen, prefs.panelPlacementChat, 'left', chatNode, chatResize)}
                    {renderSidePanel(aiPanelOpen, prefs.panelPlacementAi, 'left', aiNode('left'), aiResize)}

                    {/* Center: vertical split — arrangement over the bottom panels.
                        The arrangement takes what the panels leave, down to its
                        minimum; each panel shrinks to its own minimum first. Only
                        when every minimum together exceeds the window (the editor
                        dock and the keyboard on a short
                        screen) does this column scroll, as the last resort. */}
                    <Stack
                        grow
                        className="min-w-0 overflow-x-hidden overflow-y-auto"
                        style={{ minWidth: MIN_ARRANGE_COLUMN_WIDTH }}
                    >
                        {/* Main arrangement area */}
                        <main
                            id="main-content"
                            tabIndex={-1}
                            data-focus-landmark=""
                            className="contain-content flex-1 min-h-0 overflow-hidden"
                            style={{ minHeight: arrangementMinimumHeight }}
                        >
                            {children}
                        </main>

                        {/* Mixer bottom panel */}
                        {mixerOpen ? (
                            <>
                                <DragResizeHandle
                                    side="top"
                                    aria-label={
                                        activeBottomTab === 'editor' ? 'Resize editor panel' : 'Resize mixer panel'
                                    }
                                    onResize={(d) => {
                                        if (activeBottomTab === 'editor') {
                                            setEditorHeight((h) => Math.max(EDITOR_MIN_HEIGHT, h + d));
                                        } else {
                                            setMixerHeight((h) => Math.max(MIXER_MIN_HEIGHT, h + d));
                                        }
                                    }}
                                />
                                <DawPanelSurface
                                    tone="dock"
                                    className="shrink contain-strict overflow-hidden"
                                    style={{
                                        height: activeBottomTab === 'editor' ? editorHeight : mixerHeight,
                                        minHeight: activeBottomTab === 'editor' ? EDITOR_MIN_HEIGHT : MIXER_MIN_HEIGHT,
                                    }}
                                >
                                    {/* Bottom panel tab bar */}
                                    <DawHeaderBand compact className="flex items-center gap-0.5 px-2 py-0.5">
                                        <DawTabStrip
                                            label="Bottom dock"
                                            idPrefix={BOTTOM_TAB_ID_PREFIX}
                                            items={visibleBottomTabs}
                                            activeId={activeBottomTab}
                                            panelId={BOTTOM_TABPANEL_ID}
                                            onChange={setBottomTab}
                                            className="flex-1"
                                            scrollerClassName="gap-0.5 py-px"
                                        />

                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            onClick={toggleMixer}
                                            aria-label="Close bottom dock"
                                        >
                                            <X className="size-3.5" />
                                        </Button>
                                    </DawHeaderBand>
                                    {/* Panel content */}
                                    <div
                                        role="tabpanel"
                                        id={BOTTOM_TABPANEL_ID}
                                        aria-labelledby={getDawTabId(BOTTOM_TAB_ID_PREFIX, activeBottomTab)}
                                        tabIndex={0}
                                        className="flex-1 overflow-hidden"
                                    >
                                        <ErrorBoundary variant="inline">{renderBottomTabContent()}</ErrorBoundary>
                                    </div>
                                </DawPanelSurface>
                            </>
                        ) : null}

                        {/* Virtual Keyboard panel */}
                        {virtualKeyboardOpen ? (
                            <>
                                <DragResizeHandle
                                    side="top"
                                    aria-label="Resize virtual keyboard"
                                    onResize={(d) => {
                                        const next = clamp(
                                            virtualKeyboardHeight + d,
                                            VIRTUAL_KEYBOARD_HEIGHT_BOUNDS.min,
                                            VIRTUAL_KEYBOARD_HEIGHT_BOUNDS.max
                                        );
                                        updateWorkspaceState({ virtualKeyboardHeight: next });
                                    }}
                                />
                                <div
                                    className="overflow-hidden"
                                    data-testid="virtual-keyboard-dock"
                                    style={{
                                        height: virtualKeyboardHeight,
                                        minHeight: VIRTUAL_KEYBOARD_HEIGHT_BOUNDS.min,
                                    }}
                                >
                                    <VirtualKeyboard onClose={toggleVirtualKeyboard} />
                                </div>
                            </>
                        ) : null}
                    </Stack>

                    {/* Right dynamically placed panels */}
                    {renderSidePanel(sidebarOpen, prefs.panelPlacementSidebar, 'right', sidebarNode, sidebarResize)}
                    {renderSidePanel(
                        inspectorOpen,
                        prefs.panelPlacementInspector,
                        'right',
                        inspectorNode,
                        inspectorResize
                    )}
                    {renderSidePanel(chatPanelOpen, prefs.panelPlacementChat, 'right', chatNode, chatResize)}
                    {renderSidePanel(aiPanelOpen, prefs.panelPlacementAi, 'right', aiNode('right'), aiResize)}
                    <ActiveDeviceEditor panel={activePanel} onClose={closeActivePanel} />
                </Row>

                <StatusBar />
                <UndoHistoryPanel />
                {collaborationPanelOpen ? (
                    <ErrorBoundary>
                        <Suspense fallback={<LazyPanelFallback />}>
                            <CollaborationPanelLazy />
                        </Suspense>
                    </ErrorBoundary>
                ) : null}
                {branchManagerOpen ? (
                    <ErrorBoundary>
                        <Suspense fallback={<LazyPanelFallback />}>
                            <BranchManagerDialogLazy onClose={closeBranchManager} />
                        </Suspense>
                    </ErrorBoundary>
                ) : null}

                <CommandPalette />
                <VoiceCommandOverlay />
                <AiChangeToast />
                <AiActionHistoryPanel />
                <MixAnalysisPanel />
                <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
                <PreferencesDialog
                    open={prefsOpen}
                    requestedSection={prefsSection}
                    onClose={() => setPrefsOpen(false)}
                />

                <AlphaNoticeDialog
                    open={showAlphaNotice}
                    onOpenChange={(open) => {
                        if (!open) {
                            dismissAlphaNotice();
                        }
                    }}
                />

                {/* Loading overlay for returning-user project load */}
                {project.loading ? <ProjectLoadingOverlay /> : null}

                {/* Launch screen overlay — shown for new users, fades out when project initializes */}
                {showLaunch ? <LaunchScreen exiting={launchExiting} /> : null}
            </Stack>

            {/* Siblings of the shell root, not children, because the root goes
                `inert` below. These are the app's only channels for telling the
                user something and for asking them a question, and `inert`
                removes a subtree from the accessibility tree as well as the tab
                order — so inside it a `role="alert"` toast is neither announced
                nor reachable, and a pending `confirmUser` becomes unclickable
                with no way to answer it. Anything that must still speak to the
                user while the shell is inert belongs out here. */}
            <NotificationToast />
            <ConfirmDialog />
            <PromptDialog />

            {/* Also a sibling, for the same reason as the failure overlay below:
                it declares `aria-modal="true"`, so the shell root goes `inert`
                while it is open and it cannot be inside that subtree. */}
            <ShortcutHelp onOpenChange={setCheatSheetOpen} />
            {onboarding.active ? <OnboardingTour /> : null}

            {/* Terminal open failure: the previous session is gone and no
                project replaced it. Gated on its own store rather than the
                transient flags — `launchReady` latches on the first open, so
                mid-session `{ initialized: false, loading: false }` shows
                neither the launch screen nor the loading overlay, only the
                editor.

                Rendered as a *sibling* of the shell root, which goes `inert`
                above. A focus trap bound to the dialog only holds while focus
                is already inside it, and a round trip through browser chrome
                re-enters at the first focusable node — app chrome behind the
                modal. `inert` takes the whole shell out of the tab order and
                out of the a11y tree, which is what `aria-modal="true"` has
                been claiming all along.

                Except for portals: Radix renders into `document.body`, outside
                this subtree, so a tooltip or popover already open when the
                failure lands is not covered by `inert` and can sit in the a11y
                tree beside the dialog. Not addressed here. */}
            {projectLoadFailure ? (
                <ProjectLoadFailureOverlay
                    message={projectLoadFailure.message}
                    projectName={projectLoadFailure.projectName}
                    onReload={() => window.location.reload()}
                />
            ) : null}
        </>
    );
};
