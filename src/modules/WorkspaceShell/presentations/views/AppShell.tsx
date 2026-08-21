import { type ReactElement, type ReactNode, lazy, Suspense, useEffect, useState } from 'react';

import { X } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { DragResizeHandle } from '#/components/ui/DragResizeHandle';
import { ConfirmDialog } from '#/infra/dialogService/ConfirmDialog';
import { NotificationToast } from '#/infra/dialogService/NotificationToast';
import { PromptDialog } from '#/infra/dialogService/PromptDialog';
import { useStore } from '#/infra/store/useStore';
import { aiStore } from '#/modules/AiGeneration/stores';
import {
    GenerativeAiPanel,
    ChatPanel,
    VoiceCommandOverlay,
    AiChangeToast,
    AiActionHistoryPanel,
    MixAnalysisPanel,
} from '#/modules/AiRuntime/presentations/views';
import { clipSelectionStore, defaultClipSelectionState, trackStore } from '#/modules/Arrangement/stores';
import { ExportDialog } from '#/modules/AudioRendering/presentations/views';
import { ModulationMatrix } from '#/modules/Automation/presentations/views';
import { BacteriaPanel } from '#/modules/Bacteria/presentations/views';
import { UndoHistoryPanel } from '#/modules/Command/presentations/views';
import { CommandPalette, useGlobalKeyboardShortcuts } from '#/modules/CommandInterface/presentations/views';
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
import { PreferencesDialog } from '#/modules/Preferences/presentations/views';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { ProofPanel } from '#/modules/Proof/presentations/views';
import { ProofChamberPanel } from '#/modules/ProofChamber/presentations/views';
import { RoutingMatrix } from '#/modules/Routing/presentations/views';
import { LoopStationPanel, SessionView } from '#/modules/SessionLauncher/presentations/views';
import { SetlistPanel } from '#/modules/Setlist/presentations/views';
import { AutomationBottomPanel, ClipView, InspectorPanel } from '#/modules/TimelineEditor/presentations/views';
import { ToasterPanel } from '#/modules/Toaster/presentations/views';
import { TunerPanel } from '#/modules/Tuner/presentations/views';
import { YeastPanel } from '#/modules/Yeast/presentations/views';
import { clamp } from '#/utils/Math/clamp';

import { alphaNoticeStore } from '../../stores/alphaNoticeStore';
import { dismissAlphaNotice } from '../../useCases/dismissAlphaNotice';
import { onPanelShowAutomation } from '../../useCases/panels/devicePanels/onPanelShowAutomation';
import { showBacteriaPanel } from '../../useCases/panels/devicePanels/showBacteriaPanel';
import { showCrumbsPanel } from '../../useCases/panels/devicePanels/showCrumbsPanel';
import { showCrustPanel } from '../../useCases/panels/devicePanels/showCrustPanel';
import { showDevicePanel } from '../../useCases/panels/devicePanels/showDevicePanel';
import { showDutchOvenPanel } from '../../useCases/panels/devicePanels/showDutchOvenPanel';
import { showFermenterPanel } from '../../useCases/panels/devicePanels/showFermenterPanel';
import { showGlutenPanel } from '../../useCases/panels/devicePanels/showGlutenPanel';
import { showGrandBoulePanel } from '../../useCases/panels/devicePanels/showGrandBoulePanel';
import { showLevainPanel } from '../../useCases/panels/devicePanels/showLevainPanel';
import { showProofPanel } from '../../useCases/panels/devicePanels/showProofPanel';
import { showScoringPanel } from '../../useCases/panels/devicePanels/showScoringPanel';
import { showToasterPanel } from '../../useCases/panels/devicePanels/showToasterPanel';
import { showYeastPanel } from '../../useCases/panels/devicePanels/showYeastPanel';
import { closeBranchManager } from '../../useCases/togglePanel/panelToggles/closeBranchManager';
import { openMixer } from '../../useCases/togglePanel/panelToggles/openMixer';
import { toggleMixer } from '../../useCases/togglePanel/panelToggles/toggleMixer';
import { toggleSidebar } from '../../useCases/togglePanel/panelToggles/toggleSidebar';
import { toggleVirtualKeyboard } from '../../useCases/togglePanel/panelToggles/toggleVirtualKeyboard';
import { updateWorkspaceState } from '../../useCases/workspaceState';
import { AlphaNoticeDialog } from '../components/AlphaNoticeDialog';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { InstrumentBottomPanel } from '../components/InstrumentBottomPanel';
import { ProjectLoadFailureOverlay } from '../components/ProjectLoadFailureOverlay';
import { ProjectLoadingOverlay } from '../components/ProjectLoadingOverlay';
import { ShortcutCheatSheet } from '../components/ShortcutCheatSheet';
import { useActiveDevicePanel } from '../hooks/useActiveDevicePanel';
import { useAppEventHandlers } from '../hooks/useAppEventHandlers';
import { useAppInitialization } from '../hooks/useAppInitialization';
import { useProjectLoadFailure } from '../hooks/useProjectLoadFailure';
import { useProjectState } from '../hooks/useProjectState';
import { useWorkspaceState } from '../hooks/useWorkspaceState';

import { LaunchScreen } from './LaunchScreen';
import { StatusBar } from './StatusBar';
import { TransportBar } from './TransportBar';
import { VirtualKeyboard } from './VirtualKeyboard';

// Device-panel emitters injected into the ContentBrowser Sidebar. The panel
// system is owned by Workspace; the browser only triggers it, so these stable
// singletons are passed in as callbacks (module-level — no per-render alloc).
const SIDEBAR_PANEL_ACTIONS: SidebarPanelActions = {
    showBacteria: showBacteriaPanel,
    showCrust: showCrustPanel,
    showDevice: showDevicePanel,
    showDutchOven: showDutchOvenPanel,
    showGluten: showGlutenPanel,
    showProof: showProofPanel,
    showScoring: showScoringPanel,
    showYeast: showYeastPanel,
    showCrumbs: showCrumbsPanel,
    showFermenter: showFermenterPanel,
    showGrandBoule: showGrandBoulePanel,
    showLevain: showLevainPanel,
    showToaster: showToasterPanel,
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
    <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid="lazy-panel-fallback"
    >
        <div className="flex flex-col gap-3 rounded-md bg-surface-raised p-4 shadow-lg">
            <div className="h-4 w-40 animate-pulse rounded bg-surface-base" />
            <div className="h-32 w-72 animate-pulse rounded bg-surface-base" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-base" />
        </div>
        <span className="sr-only">Loading…</span>
    </div>
);

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
    | 'elastic';

type BottomTabState = {
    value: BottomTabValue;
    selectedClipId: string | null;
};

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
        chatPanelWidth: chatWidth,
        aiPanelWidth: aiWidth,
        fermenterHeight,
        toasterHeight,
        levainHeight,
        glutenHeight,
        bacteriaHeight,
        grinderHeight,
        proofChamberHeight,
        proofHeight,
        scoringHeight,
        yeastHeight,
        virtualKeyboardOpen,
        virtualKeyboardHeight,
        crustHeight,
        samplerHeight,
        grandBouleHeight,
    } = workspaceState;
    const selectedClipId = useStore(clipSelectionStore, defaultClipSelectionState).selectedClipId;

    const project = useProjectState();
    const projectLoadFailure = useProjectLoadFailure();
    const prefs = useStore(preferencesStore, defaultPreferences);
    const tracksSnapshot = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const isAudioClipSelected =
        selectedClipId !== null &&
        tracksSnapshot.tracks.some((track) =>
            track.clips.some((clip) => clip.id === selectedClipId && clip.type === 'audio')
        );
    const aiState = useStore(aiStore, { tasks: [], isPanelOpen: false });
    const aiPanelOpen = aiState.isPanelOpen;
    const alphaDismissed = useStore(alphaNoticeStore);
    const showAlphaNotice = project.initialized && !alphaDismissed;
    const [exportOpen, setExportOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [bottomTabState, setBottomTabState] = useState<BottomTabState>({ value: 'mixer', selectedClipId: null });
    const selectedClipChanged = bottomTabState.selectedClipId !== selectedClipId;
    const selectedClipBottomTab = selectedClipChanged && selectedClipId !== null ? 'editor' : bottomTabState.value;
    const elasticBottomTabUnavailable = selectedClipBottomTab === 'elastic' && !isAudioClipSelected;
    const bottomTab: BottomTabValue = elasticBottomTabUnavailable ? 'editor' : selectedClipBottomTab;

    if (selectedClipChanged || elasticBottomTabUnavailable) {
        setBottomTabState({
            value: bottomTab,
            selectedClipId,
        });
    }

    const setBottomTab = (value: BottomTabValue): void => {
        setBottomTabState({ value, selectedClipId });
    };
    const activeBottomTab = bottomTab;

    // The cheat sheet owns its own '?' keydown toggle and is a leaf component, so it
    // cannot be read out of workspace state; it reports its open state up instead.
    const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

    // The onboarding tour is a full-screen aria-modal overlay that owns its own
    // state; read it here so the skip-link can be suppressed while it is up.
    const onboarding = useStore(onboardingStore, defaultOnboardingState);

    // One unified "active device panel" slot. The "only one panel open at a
    // time" invariant is enforced by the discriminated union in
    // useActiveDevicePanel; adding a new plugin is one line there instead of
    // three touch-points here.
    const { activePanel, closeActivePanel } = useActiveDevicePanel();
    const fermenterDeviceId = activePanel?.kind === 'fermenter' ? activePanel.deviceId : null;
    const toasterDeviceId = activePanel?.kind === 'toaster' ? activePanel.deviceId : null;
    const levainDeviceId = activePanel?.kind === 'levain' ? activePanel.deviceId : null;
    const proofChamberDeviceId = activePanel?.kind === 'proofChamber' ? activePanel.deviceId : null;
    const glutenDeviceId = activePanel?.kind === 'gluten' ? activePanel.deviceId : null;
    const bacteriaDeviceId = activePanel?.kind === 'bacteria' ? activePanel.deviceId : null;
    const grinderDeviceId = activePanel?.kind === 'grinder' ? activePanel.deviceId : null;
    const scoringDeviceId = activePanel?.kind === 'scoring' ? activePanel.deviceId : null;
    const proofDeviceId = activePanel?.kind === 'proof' ? activePanel.deviceId : null;
    const yeastOpen = activePanel?.kind === 'yeast';
    // `null` while the panel is closed OR bound to no device — the panel then
    // resolves its device from the selected track (issue #2422: the rack the
    // panel edits must belong to one device instance).
    const yeastDeviceId = activePanel?.kind === 'yeast' ? activePanel.deviceId : null;
    const crustDeviceId = activePanel?.kind === 'crust' ? activePanel.deviceId : null;
    const samplerDeviceId = activePanel?.kind === 'sampler' ? activePanel.deviceId : null;
    const grandBouleDeviceId = activePanel?.kind === 'grandBoule' ? activePanel.deviceId : null;

    // ─── Extracted hooks ───
    // §10.2 item 1 — Keyboard shortcuts are now unified under
    // `useGlobalKeyboardShortcuts` / `Command/stores/shortcutStore`. The
    // dialog-open shortcuts dispatch `openExportDialog()` /
    // `openPreferencesDialog()` which emit `dialog.*` events consumed by
    // `useAppEventHandlers` below — that's the single source of truth for
    // flipping these dialogs open.
    useAppInitialization();
    useGlobalKeyboardShortcuts();

    useAppEventHandlers({
        onOpenExport: () => setExportOpen(true),
        onOpenPreferences: () => setPrefsOpen(true),
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

    // Auto-switch bottom tab when clip selected
    useEffect(() => {
        if (selectedClipId) {
            openMixer();
        }
    }, [selectedClipId]);

    // Listen for automation tab activation (from 'A' key)
    useEffect(() => {
        return onPanelShowAutomation(() => {
            setBottomTabState({ value: 'automation', selectedClipId });
            if (!mixerOpen) {
                openMixer();
            }
        });
    }, [mixerOpen, selectedClipId]);

    // ─── Panel dimension setters (persisted via workspace store) ───
    // All 14 setters share the pattern `fn => updateWorkspaceState({ [key]: fn(current) })`
    // Generic helper keeps the JSX readable without 14 nearly-identical one-liners (§47.4).
    type DimKey =
        | 'sidebarWidth'
        | 'inspectorWidth'
        | 'chatPanelWidth'
        | 'aiPanelWidth'
        | 'mixerHeight'
        | 'fermenterHeight'
        | 'toasterHeight'
        | 'levainHeight'
        | 'glutenHeight'
        | 'bacteriaHeight'
        | 'grinderHeight'
        | 'proofChamberHeight'
        | 'proofHeight'
        | 'scoringHeight'
        | 'yeastHeight'
        | 'crustHeight'
        | 'samplerHeight'
        | 'grandBouleHeight';
    const makeDimSetter = (key: DimKey, current: number) => (fn: (prev: number) => number) =>
        updateWorkspaceState({ [key]: fn(current) });

    const setSidebarWidth = makeDimSetter('sidebarWidth', sidebarWidth);
    const setInspectorWidth = makeDimSetter('inspectorWidth', inspectorWidth);
    const setChatWidth = makeDimSetter('chatPanelWidth', chatWidth);
    const setAiWidth = makeDimSetter('aiPanelWidth', aiWidth);
    const setMixerHeight = makeDimSetter('mixerHeight', mixerHeight);
    const setFermenterHeight = makeDimSetter('fermenterHeight', fermenterHeight);
    const setToasterHeight = makeDimSetter('toasterHeight', toasterHeight);
    const setLevainHeight = makeDimSetter('levainHeight', levainHeight);
    const setGlutenHeight = makeDimSetter('glutenHeight', glutenHeight);
    const setBacteriaHeight = makeDimSetter('bacteriaHeight', bacteriaHeight);
    const setGrinderHeight = makeDimSetter('grinderHeight', grinderHeight);
    const setProofChamberHeight = makeDimSetter('proofChamberHeight', proofChamberHeight);
    const setProofHeight = makeDimSetter('proofHeight', proofHeight);
    const setScoringHeight = makeDimSetter('scoringHeight', scoringHeight);
    const setYeastHeight = makeDimSetter('yeastHeight', yeastHeight);
    const setCrustHeight = makeDimSetter('crustHeight', crustHeight);
    const setSamplerHeight = makeDimSetter('samplerHeight', samplerHeight);
    const setGrandBouleHeight = makeDimSetter('grandBouleHeight', grandBouleHeight);

    // §47.3 — Sidebar / Inspector / Chat / Ai panels render symmetrically on
    // both sides of the main content. Prior to this helper, each panel was
    // rendered twice (~80 lines of near-identical JSX) with only the handle
    // side and the border direction differing.
    const renderSidePanel = (
        open: boolean,
        placement: 'left' | 'right',
        side: 'left' | 'right',
        panel: ReactNode,
        onResize: (d: number) => void
    ): ReactNode => {
        if (!open || placement !== side) {
            return null;
        }
        const handle = <DragResizeHandle side={side === 'left' ? 'right' : 'left'} onResize={onResize} />;
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

    const sidebarNode = (
        <Sidebar
            style={{ width: sidebarWidth, minWidth: 180 }}
            onClose={toggleSidebar}
            panelActions={SIDEBAR_PANEL_ACTIONS}
        />
    );
    const inspectorNode = <InspectorPanel style={{ width: inspectorWidth, minWidth: 200 }} />;
    const chatNode = <ChatPanel style={{ width: chatWidth, minWidth: 200 }} />;
    const aiNode = (side: 'left' | 'right'): ReactNode => (
        <div
            className={`flex flex-col ${
                side === 'left' ? 'border-r' : 'border-l'
            } border-border-hairline bg-surface-tray overflow-hidden`}
            style={{ width: aiWidth, minWidth: 200 }}
        >
            <GenerativeAiPanel />
        </div>
    );
    const onSidebarResize = (d: number): void => setSidebarWidth((w) => clamp(w + d, 180, 500));
    const onInspectorResize = (d: number): void => setInspectorWidth((w) => clamp(w + d, 200, 500));
    const onChatResize = (d: number): void => setChatWidth((w) => clamp(w + d, 200, 600));
    const onAiResize = (d: number): void => setAiWidth((w) => clamp(w + d, 200, 500));

    // ─── Launch screen overlay state ───────────────────────────────────────
    // We start hidden (loading:true is the default). New-user loading completion
    // shows the launch screen; initialization derives the exit animation and the
    // existing timer unmounts it after 700ms.
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
        }, 700);
        return () => clearTimeout(timer);
    }, [launchExiting]);

    // Bottom-dock tab id helpers. `id`/`aria-controls`/`aria-labelledby` wire
    // each tab to the single shared tabpanel so AT announces the dock as one
    // tablist instead of N unrelated buttons.
    const bottomTabButtonId = (value: BottomTabValue): string => `bottom-dock-tab-${value}`;
    const BOTTOM_TABPANEL_ID = 'bottom-dock-tabpanel';

    // Renders one dock tab with the `role="tab"` / `aria-selected` semantics,
    // preserving each tab's existing variant, accent colour and data-* hooks.
    const renderBottomTab = (
        value: BottomTabValue,
        label: string,
        activeClassName: string,
        extraProps: Record<string, string> = {}
    ): ReactNode => {
        const selected = activeBottomTab === value;
        return (
            <Button
                role="tab"
                id={bottomTabButtonId(value)}
                aria-selected={selected}
                aria-controls={BOTTOM_TABPANEL_ID}
                variant={selected ? 'secondary' : 'ghost'}
                size="xs"
                className={selected ? activeClassName : ''}
                onClick={() => setBottomTab(value)}
                {...extraProps}
            >
                {label}
            </Button>
        );
    };

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
            default:
                return <RoutingMatrix />;
        }
    };

    return (
        <>
            <div
                className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app"
                data-testid="app-shell"
                inert={projectLoadFailure !== null || cheatSheetOpen}
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
                <TransportBar />

                {/* ─── Main horizontal layout ─── */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Left dynamically placed panels */}
                    {renderSidePanel(sidebarOpen, prefs.panelPlacementSidebar, 'left', sidebarNode, onSidebarResize)}
                    {renderSidePanel(
                        inspectorOpen,
                        prefs.panelPlacementInspector,
                        'left',
                        inspectorNode,
                        onInspectorResize
                    )}
                    {renderSidePanel(chatPanelOpen, prefs.panelPlacementChat, 'left', chatNode, onChatResize)}
                    {renderSidePanel(aiPanelOpen, prefs.panelPlacementAi, 'left', aiNode('left'), onAiResize)}

                    {/* Center: vertical split — arrangement over mixer */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                        {/* Main arrangement area */}
                        <main id="main-content" className="contain-strict flex-1 overflow-hidden min-h-0">
                            {children}
                        </main>

                        {fermenterDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Fermenter"
                                labelColor="text-[var(--color-accent-lavender)]"
                                borderColor="border-[var(--color-accent-lavender)]/20"
                                height={fermenterHeight}
                                onResize={setFermenterHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <FermenterPanel deviceId={fermenterDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {toasterDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Toaster"
                                labelColor="text-[var(--color-accent-peach)]"
                                borderColor="border-[var(--color-accent-peach)]/20"
                                height={toasterHeight}
                                onResize={setToasterHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <ToasterPanel deviceId={toasterDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {levainDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Levain"
                                labelColor="text-amber-400"
                                borderColor="border-amber-500/20"
                                height={levainHeight}
                                onResize={setLevainHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <LevainPanel deviceId={levainDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {proofChamberDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Dutch Oven"
                                labelColor="text-[var(--color-accent-cyan)]"
                                borderColor="border-[var(--color-accent-cyan)]/20"
                                height={proofChamberHeight}
                                onResize={setProofChamberHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <ProofChamberPanel deviceId={proofChamberDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {glutenDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Gluten"
                                labelColor="text-[var(--color-accent-peach)]"
                                borderColor="border-[var(--color-accent-peach)]/20"
                                height={glutenHeight}
                                onResize={setGlutenHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <GlutenPanel deviceId={glutenDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {bacteriaDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Bacteria"
                                labelColor="text-rose-400"
                                borderColor="border-rose-500/20"
                                height={bacteriaHeight}
                                onResize={setBacteriaHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <BacteriaPanel deviceId={bacteriaDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {grinderDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Grinder"
                                labelColor="text-amber-500"
                                borderColor="border-amber-600/20"
                                height={grinderHeight}
                                onResize={setGrinderHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <GrinderPanel deviceId={grinderDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {proofDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Proof"
                                labelColor="text-[var(--color-accent-mint)]"
                                borderColor="border-[var(--color-accent-mint)]/20"
                                height={proofHeight}
                                onResize={setProofHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <ProofPanel deviceId={proofDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {scoringDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Scoring"
                                labelColor="text-[var(--color-accent-mint)]"
                                borderColor="border-[var(--color-accent-mint)]/20"
                                height={scoringHeight}
                                onResize={setScoringHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <TunerPanel deviceId={scoringDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {yeastOpen ? (
                            <InstrumentBottomPanel
                                label="Yeast"
                                labelColor="text-[var(--color-accent-peach)]"
                                borderColor="border-[var(--color-accent-peach)]/20"
                                height={yeastHeight}
                                onResize={setYeastHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <YeastPanel deviceId={yeastDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {crustDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Crust"
                                labelColor="text-[var(--color-accent-cyan)]"
                                borderColor="border-[var(--color-accent-cyan)]/20"
                                height={crustHeight}
                                onResize={setCrustHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <CrustPanel deviceId={crustDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {samplerDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Sampler"
                                labelColor="text-[var(--color-accent-peach)]"
                                borderColor="border-[var(--color-accent-peach)]/20"
                                height={samplerHeight}
                                onResize={setSamplerHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <CrumbsPanel deviceId={samplerDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {grandBouleDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Grand Boule"
                                labelColor="text-amber-400"
                                borderColor="border-amber-500/20"
                                height={grandBouleHeight}
                                onResize={setGrandBouleHeight}
                                onClose={closeActivePanel}
                            >
                                <ErrorBoundary variant="inline">
                                    <GrandBoulePanel deviceId={grandBouleDeviceId} />
                                </ErrorBoundary>
                            </InstrumentBottomPanel>
                        ) : null}

                        {/* Mixer bottom panel */}
                        {mixerOpen ? (
                            <>
                                <DragResizeHandle
                                    side="top"
                                    onResize={(d) => setMixerHeight((h) => Math.max(120, h + d))}
                                />
                                <div
                                    className="contain-strict flex flex-col bg-surface-base overflow-hidden shrink-0"
                                    style={{ height: mixerHeight }}
                                >
                                    {/* Bottom panel tab bar */}
                                    <div
                                        className="flex items-center gap-0.5 px-2 py-0.5 shrink-0"
                                        style={{
                                            background: 'linear-gradient(180deg, #0c0c0c 0%, #0a0a0a 100%)',
                                            boxShadow:
                                                'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.4)',
                                            borderBottom: '1px solid rgba(0,0,0,0.4)',
                                        }}
                                    >
                                        <div
                                            role="tablist"
                                            aria-label="Bottom dock"
                                            className="flex items-center gap-0.5"
                                        >
                                            {renderBottomTab('mixer', 'Mixer', 'text-primary')}
                                            {renderBottomTab('editor', 'Editor', 'text-[var(--color-accent-cyan)]')}
                                            {renderBottomTab(
                                                'automation',
                                                'Automation',
                                                'text-[var(--color-accent-lavender)]'
                                            )}
                                            {renderBottomTab('session', 'Session', 'text-[var(--color-accent-mint)]')}
                                            {renderBottomTab('routing', 'Routing', 'text-[var(--color-accent-peach)]')}
                                            {renderBottomTab(
                                                'analysis',
                                                'Analysis',
                                                'text-[var(--color-accent-lavender)]'
                                            )}
                                            {renderBottomTab('setlist', 'Setlist', 'text-[var(--color-accent-amber)]', {
                                                'data-onboarding': 'setlist-tab',
                                            })}
                                            {renderBottomTab(
                                                'loopStation',
                                                'Loop Station',
                                                'text-[var(--color-accent-mint)]',
                                                { 'data-onboarding': 'loop-station-tab' }
                                            )}
                                            {renderBottomTab(
                                                'modulation',
                                                'Modulation',
                                                'text-[var(--color-accent-cyan)]',
                                                { 'data-onboarding': 'modulation-tab' }
                                            )}
                                            {isAudioClipSelected
                                                ? renderBottomTab(
                                                      'elastic',
                                                      'Elastic',
                                                      'text-[var(--color-accent-peach)]',
                                                      { 'data-testid': 'elastic-tab-button' }
                                                  )
                                                : null}
                                        </div>

                                        <div className="flex-1" />

                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            onClick={toggleMixer}
                                            aria-label="Close bottom dock"
                                        >
                                            <X className="size-3.5" />
                                        </Button>
                                    </div>
                                    {/* Panel content */}
                                    <div
                                        role="tabpanel"
                                        id={BOTTOM_TABPANEL_ID}
                                        aria-labelledby={bottomTabButtonId(activeBottomTab)}
                                        tabIndex={0}
                                        className="flex-1 overflow-hidden"
                                    >
                                        <ErrorBoundary variant="inline">{renderBottomTabContent()}</ErrorBoundary>
                                    </div>
                                </div>
                            </>
                        ) : null}

                        {/* Virtual Keyboard panel */}
                        {virtualKeyboardOpen ? (
                            <>
                                <DragResizeHandle
                                    side="top"
                                    onResize={(d) => {
                                        const next = Math.max(80, Math.min(400, virtualKeyboardHeight + d));
                                        updateWorkspaceState({ virtualKeyboardHeight: next });
                                    }}
                                />
                                <div className="shrink-0 overflow-hidden" style={{ height: virtualKeyboardHeight }}>
                                    <VirtualKeyboard onClose={toggleVirtualKeyboard} />
                                </div>
                            </>
                        ) : null}
                    </div>

                    {/* Right dynamically placed panels */}
                    {renderSidePanel(sidebarOpen, prefs.panelPlacementSidebar, 'right', sidebarNode, onSidebarResize)}
                    {renderSidePanel(
                        inspectorOpen,
                        prefs.panelPlacementInspector,
                        'right',
                        inspectorNode,
                        onInspectorResize
                    )}
                    {renderSidePanel(chatPanelOpen, prefs.panelPlacementChat, 'right', chatNode, onChatResize)}
                    {renderSidePanel(aiPanelOpen, prefs.panelPlacementAi, 'right', aiNode('right'), onAiResize)}
                </div>

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
                <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />

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

                <OnboardingTour />
            </div>

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
            <ShortcutCheatSheet onOpenChange={setCheatSheetOpen} />

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
