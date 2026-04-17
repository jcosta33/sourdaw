import { type ReactElement, type ReactNode, lazy, Suspense, useEffect, useState } from 'react';
import { LaunchScreen } from '../components/LaunchScreen';
import { ProjectLoadingOverlay } from '../components/ProjectLoadingOverlay';
import { useActiveDevicePanel } from '../hooks/useActiveDevicePanel';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { updateWorkspaceState } from '../../useCases/workspaceState';
import { useProjectState } from '../hooks/useProjectState';
import { useAppInitialization } from '../hooks/useAppInitialization';
import { useAppEventHandlers } from '../hooks/useAppEventHandlers';
import { onPanelShowAutomation } from '../../useCases/panels/devicePanels/onPanelShowAutomation';
import { clamp } from '#/utils/Math/clamp';
import { TransportBar } from './TransportBar';
import { Sidebar } from './Sidebar';
import { InspectorPanel } from './InspectorPanel';
import {
    GenerativeAiPanel,
    ChatPanel,
    VoiceCommandOverlay,
    AiChangeToast,
    AiActionHistoryPanel,
    MixAnalysisPanel,
} from '#/modules/AiRuntime/presentations/views';
import { MixerPanel } from './MixerPanel';
import { SessionView } from './SessionView';
import { RoutingMatrix } from './RoutingMatrix';
import { AutomationBottomPanel } from './AutomationBottomPanel';
import { ClipView } from './ClipView';
import { AnalysisPanel } from './AnalysisPanel';
import { FermenterPanel } from '#/modules/Fermenter/presentations/views';
import { ToasterPanel } from '#/modules/Toaster/presentations/views';
import { InstrumentBottomPanel } from '../components/InstrumentBottomPanel';
import { LevainPanel } from '#/modules/Levain/presentations/views';
import { ProofChamberPanel } from '#/modules/Plugin/presentations/views';
import { GlutenPanel } from '#/modules/Gluten/presentations/views';
import { BacteriaPanel } from '#/modules/Bacteria/presentations/views';
import { GrinderPanel } from '#/modules/Grinder/presentations/views';
import { CrumbsPanel } from '#/modules/Crumbs/presentations/views';
import { GrandBoulePanel } from '#/modules/GrandBoule/presentations/views';

import { ProofPanel } from '#/modules/Proof/presentations/views';
import { ScoringPanel } from '#/modules/Scoring/presentations/views';
import { YeastPanel } from '#/modules/Yeast/presentations/views';
import { CrustPanel } from '#/modules/Crust/presentations/views';
import { VirtualKeyboard } from '#/modules/VirtualKeyboard/presentations/views';
import { toggleVirtualKeyboard } from '../../useCases/togglePanel/panelToggles/toggleVirtualKeyboard';
import { closeBranchManager } from '../../useCases/togglePanel/panelToggles/closeBranchManager';

import { CommandPalette, useGlobalKeyboardShortcuts, UndoHistoryPanel } from '#/modules/Command/presentations/views';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NotificationToast } from '../components/NotificationToast';
import { useStore } from '#/infra/store/useStore';
import { aiStore } from '#/modules/AiGeneration/stores';
import { ExportDialog } from '#/modules/Project/presentations/views';
import { PreferencesDialog } from './PreferencesDialog';
import { openMixer } from '../../useCases/togglePanel/panelToggles/openMixer';
import { StatusBar } from './StatusBar';
import { ShortcutCheatSheet } from '../components/ShortcutCheatSheet';

import { Button } from '#/components/ui/button';
import { AlphaNoticeDialog } from '../components/AlphaNoticeDialog';
import { CapabilityBanner } from '../components/CapabilityBanner';
import { X } from 'lucide-react';
import { toggleMixer } from '../../useCases/togglePanel/panelToggles/toggleMixer';
import { DragResizeHandle } from '#/components/ui/DragResizeHandle';
import { preferencesStore } from '../../stores/preferencesStore';
import { defaultPreferences } from '../../models/Preferences';
import { MobileGate } from '../components/MobileGate';

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

type AppShellProps = {
    children: ReactNode;
};

const ALPHA_NOTICE_KEY = 'sourdaw-alpha-notice-dismissed';

export const AppShell = ({ children }: AppShellProps): ReactElement => {
    const workspaceState = useWorkspaceState();
    const {
        sidebarOpen,
        inspectorOpen,
        mixerOpen,
        collaborationPanelOpen,
        branchManagerOpen,
        chatPanelOpen,
        selectedClipId,
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

    const project = useProjectState();
    const prefs = useStore(preferencesStore, defaultPreferences);
    const aiState = useStore(aiStore, { tasks: [], isPanelOpen: false });
    const aiPanelOpen = aiState.isPanelOpen;
    const [exportOpen, setExportOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [showAlphaNotice, setShowAlphaNotice] = useState(false);
    const [bottomTab, setBottomTab] = useState<'editor' | 'mixer' | 'session' | 'routing' | 'analysis' | 'automation'>(
        'mixer'
    );
    // One unified "active device panel" slot. The "only one panel open at a
    // time" invariant is enforced by the discriminated union in
    // useActiveDevicePanel; adding a new plugin is one line there instead of
    // three touch-points here.
    const { activePanel, closeActivePanel } = useActiveDevicePanel();
    const fermenterDeviceId = activePanel?.kind === 'fermenter' ? activePanel.deviceId : null;
    const toasterDeviceId = activePanel?.kind === 'toaster' ? activePanel.deviceId : null;
    const levainOpen = activePanel?.kind === 'levain';
    const proofChamberDeviceId = activePanel?.kind === 'proofChamber' ? activePanel.deviceId : null;
    const glutenDeviceId = activePanel?.kind === 'gluten' ? activePanel.deviceId : null;
    const bacteriaDeviceId = activePanel?.kind === 'bacteria' ? activePanel.deviceId : null;
    const grinderDeviceId = activePanel?.kind === 'grinder' ? activePanel.deviceId : null;
    const scoringDeviceId = activePanel?.kind === 'scoring' ? activePanel.deviceId : null;
    const proofDeviceId = activePanel?.kind === 'proof' ? activePanel.deviceId : null;
    const yeastOpen = activePanel?.kind === 'yeast';
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

    // Show alpha notice when project initializes — localStorage is the
    // source of truth, so HMR can't cause the notice to re-appear.
    useEffect(() => {
        if (project.initialized && localStorage.getItem(ALPHA_NOTICE_KEY) !== 'true') {
            setShowAlphaNotice(true);
        }
    }, [project.initialized]);

    // Auto-switch bottom tab when clip selected
    useEffect(() => {
        if (selectedClipId) {
            setBottomTab('editor');
            openMixer();
        }
    }, [selectedClipId]);

    // Listen for automation tab activation (from 'A' key)
    useEffect(() => {
        return onPanelShowAutomation(() => {
            setBottomTab('automation');
            if (!mixerOpen) {
                openMixer();
            }
        });
    }, [mixerOpen]);

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

    const sidebarNode = <Sidebar style={{ width: sidebarWidth, minWidth: 180 }} />;
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
    // We start hidden (loading:true is the default). Two effects manage transitions:
    // 1. New-user path: loading clears without initialized → show launch screen
    // 2. Initialized fires → trigger CSS exit animation → unmount after 700ms
    const [showLaunch, setShowLaunch] = useState(false);
    const [launchExiting, setLaunchExiting] = useState(false);

    useEffect(() => {
        if (!project.initialized && !project.loading && !showLaunch && !launchExiting) {
            setShowLaunch(true);
        }
    }, [project.initialized, project.loading, showLaunch, launchExiting]);

    useEffect(() => {
        if (project.initialized && !project.loading && showLaunch && !launchExiting) {
            setLaunchExiting(true);
            const t = setTimeout(() => {
                setShowLaunch(false);
                setLaunchExiting(false);
            }, 700);
            return () => clearTimeout(t);
        }
    }, [project.initialized, project.loading, showLaunch, launchExiting]);

    return (
        <MobileGate>
            <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app" data-testid="app-shell">
                <a
                    href="#main-content"
                    className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
                >
                    Skip to content
                </a>
                <CapabilityBanner />
                <TransportBar />

                {/* ─── Main horizontal layout ─── */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Left dynamically placed panels */}
                    {renderSidePanel(sidebarOpen, prefs.panelPlacementSidebar, 'left', sidebarNode, onSidebarResize)}
                    {renderSidePanel(inspectorOpen, prefs.panelPlacementInspector, 'left', inspectorNode, onInspectorResize)}
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
                                <FermenterPanel deviceId={fermenterDeviceId} />
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
                                <ToasterPanel deviceId={toasterDeviceId} />
                            </InstrumentBottomPanel>
                        ) : null}

                        {levainOpen ? (
                            <InstrumentBottomPanel
                                label="Levain"
                                labelColor="text-amber-400"
                                borderColor="border-amber-500/20"
                                height={levainHeight}
                                onResize={setLevainHeight}
                                onClose={closeActivePanel}
                            >
                                <LevainPanel />
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
                                <ProofChamberPanel deviceId={proofChamberDeviceId} />
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
                                <GlutenPanel deviceId={glutenDeviceId} />
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
                                <BacteriaPanel deviceId={bacteriaDeviceId} />
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
                                <GrinderPanel deviceId={grinderDeviceId} />
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
                                <ProofPanel deviceId={proofDeviceId} />
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
                                <ScoringPanel deviceId={scoringDeviceId} />
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
                                <YeastPanel />
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
                                <CrustPanel deviceId={crustDeviceId} />
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
                                <CrumbsPanel deviceId={samplerDeviceId} />
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
                                <GrandBoulePanel deviceId={grandBouleDeviceId} />
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
                                        <Button
                                            variant={bottomTab === 'mixer' ? 'secondary' : 'ghost'}
                                            size="xs"
                                            className={bottomTab === 'mixer' ? 'text-primary' : ''}
                                            onClick={() => setBottomTab('mixer')}
                                        >
                                            Mixer
                                        </Button>
                                        <Button
                                            variant={bottomTab === 'editor' ? 'secondary' : 'ghost'}
                                            size="xs"
                                            className={bottomTab === 'editor' ? 'text-[var(--color-accent-cyan)]' : ''}
                                            onClick={() => setBottomTab('editor')}
                                        >
                                            Editor
                                        </Button>
                                        <Button
                                            variant={bottomTab === 'automation' ? 'secondary' : 'ghost'}
                                            size="xs"
                                            className={
                                                bottomTab === 'automation' ? 'text-[var(--color-accent-lavender)]' : ''
                                            }
                                            onClick={() => setBottomTab('automation')}
                                        >
                                            Automation
                                        </Button>
                                        <Button
                                            variant={bottomTab === 'session' ? 'secondary' : 'ghost'}
                                            size="xs"
                                            className={bottomTab === 'session' ? 'text-[var(--color-accent-mint)]' : ''}
                                            onClick={() => setBottomTab('session')}
                                        >
                                            Session
                                        </Button>
                                        <Button
                                            variant={bottomTab === 'routing' ? 'secondary' : 'ghost'}
                                            size="xs"
                                            className={
                                                bottomTab === 'routing' ? 'text-[var(--color-accent-peach)]' : ''
                                            }
                                            onClick={() => setBottomTab('routing')}
                                        >
                                            Routing
                                        </Button>
                                        <Button
                                            variant={bottomTab === 'analysis' ? 'secondary' : 'ghost'}
                                            size="xs"
                                            className={
                                                bottomTab === 'analysis' ? 'text-[var(--color-accent-lavender)]' : ''
                                            }
                                            onClick={() => setBottomTab('analysis')}
                                        >
                                            Analysis
                                        </Button>

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
                                    <div className="flex-1 overflow-hidden">
                                        {bottomTab === 'editor' ? (
                                            <ClipView />
                                        ) : bottomTab === 'mixer' ? (
                                            <MixerPanel style={{ height: '100%' }} />
                                        ) : bottomTab === 'automation' ? (
                                            <AutomationBottomPanel />
                                        ) : bottomTab === 'session' ? (
                                            <SessionView />
                                        ) : bottomTab === 'analysis' ? (
                                            <AnalysisPanel />
                                        ) : (
                                            <RoutingMatrix />
                                        )}
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
                                        const next = Math.max(80, Math.min(400, (virtualKeyboardHeight ?? 160) + d));
                                        updateWorkspaceState({ virtualKeyboardHeight: next });
                                    }}
                                />
                                <div
                                    className="shrink-0 overflow-hidden"
                                    style={{ height: virtualKeyboardHeight ?? 160 }}
                                >
                                    <VirtualKeyboard onClose={toggleVirtualKeyboard} />
                                </div>
                            </>
                        ) : null}
                    </div>

                    {/* Right dynamically placed panels */}
                    {renderSidePanel(sidebarOpen, prefs.panelPlacementSidebar, 'right', sidebarNode, onSidebarResize)}
                    {renderSidePanel(inspectorOpen, prefs.panelPlacementInspector, 'right', inspectorNode, onInspectorResize)}
                    {renderSidePanel(chatPanelOpen, prefs.panelPlacementChat, 'right', chatNode, onChatResize)}
                    {renderSidePanel(aiPanelOpen, prefs.panelPlacementAi, 'right', aiNode('right'), onAiResize)}
                </div>

                <StatusBar />
                <UndoHistoryPanel />
                {collaborationPanelOpen ? (
                    <Suspense fallback={null}>
                        <CollaborationPanelLazy />
                    </Suspense>
                ) : null}
                {branchManagerOpen ? (
                    <Suspense fallback={null}>
                        <BranchManagerDialogLazy onClose={closeBranchManager} />
                    </Suspense>
                ) : null}

                <CommandPalette />
                <VoiceCommandOverlay />
                <AiChangeToast />
                <NotificationToast />
                <ConfirmDialog />
                <AiActionHistoryPanel />
                <MixAnalysisPanel />
                <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
                <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
                <ShortcutCheatSheet />

                <AlphaNoticeDialog
                    open={showAlphaNotice}
                    onOpenChange={(open) => {
                        if (!open) {
                            localStorage.setItem(ALPHA_NOTICE_KEY, 'true');
                        }
                        setShowAlphaNotice(open);
                    }}
                />

                {/* Loading overlay for returning-user project load */}
                {project.loading ? <ProjectLoadingOverlay /> : null}

                {/* Launch screen overlay — shown for new users, fades out when project initializes */}
                {showLaunch ? <LaunchScreen exiting={launchExiting} /> : null}
            </div>
        </MobileGate>
    );
};

