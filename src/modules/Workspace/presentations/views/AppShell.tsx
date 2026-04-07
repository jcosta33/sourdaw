import { type ReactElement, type ReactNode, lazy, Suspense, useEffect, useState } from 'react';
import { LaunchScreen } from '../components/LaunchScreen';
import { ProjectLoadingOverlay } from '../components/ProjectLoadingOverlay';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { updateWorkspaceState } from '../../useCases/workspaceState';
import { useProjectState } from '../hooks/useProjectState';
import { useAppInitialization } from '../hooks/useAppInitialization';
import { useAppKeyboardShortcuts } from '../hooks/useAppKeyboardShortcuts';
import { useAppEventHandlers } from '../hooks/useAppEventHandlers';
import { eventBus } from '#/app/registerDependencies';
import { clamp } from '#/helpers/Math/clamp';
import { TransportBar } from './TransportBar';
import { Sidebar } from './Sidebar';
import { InspectorPanel } from './InspectorPanel';
import { GenerativeAiPanel } from '#/modules/AiRuntime/presentations/views/GenerativeAiPanel';
import { ChatPanel } from '#/modules/AiRuntime/presentations/views/ChatPanel';
import { MixerPanel } from './MixerPanel';
import { SessionView } from './SessionView';
import { RoutingMatrix } from './RoutingMatrix';
import { AutomationBottomPanel } from './AutomationBottomPanel';
import { ClipView } from './ClipView';
import { AnalysisPanel } from './AnalysisPanel';
import { FermenterPanel } from '#/modules/Fermenter/presentations/views/FermenterPanel';
import { ToasterPanel } from '#/modules/Toaster/presentations/views/ToasterPanel';
import { InstrumentBottomPanel } from '../components/InstrumentBottomPanel';
import { LevainPanel } from '#/modules/Levain/presentations/views/LevainPanel';
import { ProofChamberPanel } from '#/modules/ProofChamber/presentations/views/ProofChamberPanel';
import { GlutenPanel } from '#/modules/Gluten/presentations/views/GlutenPanel';
import { BacteriaPanel } from '#/modules/Bacteria/presentations/views/BacteriaPanel';
import { GrinderPanel } from '#/modules/Grinder/presentations/views/GrinderPanel';
import { SamplerPanel } from '#/modules/Sampler/presentations/views/SamplerPanel';
import { GrandBoulePanel } from '#/modules/GrandBoule/presentations/views/GrandBoulePanel';

import { ProofPanel } from '#/modules/Proof/presentations/views/ProofPanel';
import { ScoringPanel } from '#/modules/Scoring/presentations/views/ScoringPanel';
import { YeastPanel } from '#/modules/Yeast/presentations/views/YeastPanel';
import { CrustPanel } from '#/modules/Crust/presentations/views/CrustPanel';
import { VirtualKeyboard } from '#/modules/VirtualKeyboard/presentations/views/VirtualKeyboard';
import { toggleVirtualKeyboard, closeBranchManager } from '../../useCases/togglePanel/panelToggles';

import { CommandPalette } from '#/modules/Command/presentations/views/CommandPalette';
import { VoiceCommandOverlay } from '#/modules/AiRuntime/presentations/views/VoiceCommandOverlay';
import { AiChangeToast } from '#/modules/AiRuntime/presentations/views/AiChangeToast';
import { NotificationToast } from '../components/NotificationToast';
import { AiActionHistoryPanel } from '#/modules/AiRuntime/presentations/views/AiActionHistoryPanel';
import { MixAnalysisPanel } from '#/modules/AiRuntime/presentations/views/MixAnalysisPanel';
import { useStore } from '#/infra/store/useStore';
import { aiStore } from '#/modules/AiGeneration/stores/aiStore';
import { ExportDialog } from '#/modules/Project/presentations/views/ExportDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { useGlobalKeyboardShortcuts } from '#/modules/Command/presentations/views/keyboardShortcutsContract';
import { startShortcutEngine } from '../../useCases/shortcutEngine';
import { openMixer } from '../../useCases/togglePanel/panelToggles';
import { StatusBar } from './StatusBar';
import { ShortcutCheatSheet } from '../components/ShortcutCheatSheet';
import { UndoHistoryPanel } from '#/modules/Command/presentations/views/UndoHistoryPanel';

import { Button } from '#/components/ui/button';
import { AlphaNoticeDialog } from '../components/AlphaNoticeDialog';
import { X } from 'lucide-react';
import { toggleMixer } from '../../useCases/togglePanel/panelToggles';
import { DragResizeHandle } from '#/components/ui/DragResizeHandle';
import { preferencesStore } from '../../stores/preferencesStore';
import { defaultPreferences } from '../../models/Preferences';
import { MobileGate } from '../components/MobileGate';

const CollaborationPanelLazy = lazy(() =>
    import('#/modules/Collaboration/presentations/views/CollaborationPanel').then((m) => ({
        default: m.CollaborationPanel,
    }))
);

const BranchManagerDialogLazy = lazy(() =>
    import('#/modules/CrdtDocument/presentations/views/BranchManagerDialog').then((m) => ({
        default: m.BranchManagerDialog,
    }))
);

type AppShellProps = {
    children: ReactNode;
};

let hasShownAlphaNotice = false;

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
    const [fermenterDeviceId, setFermenterDeviceId] = useState<string | null>(null);
    const [toasterDeviceId, setToasterDeviceId] = useState<string | null>(null);
    const [levainOpen, setLevainOpen] = useState(false);
    const [proofChamberDeviceId, setProofChamberDeviceId] = useState<string | null>(null);
    const [glutenDeviceId, setGlutenDeviceId] = useState<string | null>(null);
    const [bacteriaDeviceId, setBacteriaDeviceId] = useState<string | null>(null);
    const [grinderDeviceId, setGrinderDeviceId] = useState<string | null>(null);
    const [scoringDeviceId, setScoringDeviceId] = useState<string | null>(null);
    const [proofDeviceId, setProofDeviceId] = useState<string | null>(null);
    const [yeastOpen, setYeastOpen] = useState(false);
    const [crustDeviceId, setCrustDeviceId] = useState<string | null>(null);
    const [samplerDeviceId, setSamplerDeviceId] = useState<string | null>(null);
    const [grandBouleDeviceId, setGrandBouleDeviceId] = useState<string | null>(null);

    // ─── Extracted hooks ───
    useAppInitialization();
    useGlobalKeyboardShortcuts();

    const dialogCallbacks = {
        onOpenExport: () => setExportOpen(true),
        onOpenPreferences: () => setPrefsOpen(true),
    };
    useAppKeyboardShortcuts(dialogCallbacks);
    useAppEventHandlers(dialogCallbacks);

    useEffect(() => {
        const cleanup = startShortcutEngine();
        return cleanup;
    }, []);

    // Show alpha notice when project initializes
    useEffect(() => {
        if (project.initialized && !hasShownAlphaNotice) {
            const hasDismissed = localStorage.getItem('sourdaw-alpha-notice-dismissed') === 'true';
            if (!hasDismissed) {
                setShowAlphaNotice(true);
            }
            hasShownAlphaNotice = true;
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
        return eventBus.on('panel.showAutomation', () => {
            setBottomTab('automation');
            if (!mixerOpen) {
                openMixer();
            }
        });
    }, [mixerOpen]);

    // ─── Shared state helpers ───
    const closeAllDevicePanels = () => {
        setFermenterDeviceId(null);
        setToasterDeviceId(null);
        setLevainOpen(false);
        setProofChamberDeviceId(null);
        setGlutenDeviceId(null);
        setBacteriaDeviceId(null);
        setGrinderDeviceId(null);
        setScoringDeviceId(null);
        setProofDeviceId(null);
        setYeastOpen(false);
        setCrustDeviceId(null);
        setSamplerDeviceId(null);
        setGrandBouleDeviceId(null);
    };

    // Listen for fermenter panel open (from inspector device click)
    useEffect(() => {
        return eventBus.on('panel.showFermenter', (payload) => {
            closeAllDevicePanels();
            setFermenterDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for toaster panel open (from inspector device click)
    useEffect(() => {
        return eventBus.on('panel.showToaster', (payload) => {
            closeAllDevicePanels();
            setToasterDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for levain panel open (from inspector device click)
    useEffect(() => {
        return eventBus.on('panel.showLevain', () => {
            closeAllDevicePanels();
            setLevainOpen(true);
        });
    }, []);

    // Listen for Dutch Oven panel open (from inspector device click)
    useEffect(() => {
        return eventBus.on('panel.showDutchOven', (payload) => {
            closeAllDevicePanels();
            setProofChamberDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for Gluten panel open (from inspector device click)
    useEffect(() => {
        return eventBus.on('panel.showGluten', (payload) => {
            closeAllDevicePanels();
            setGlutenDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for Bacteria panel open
    useEffect(() => {
        return eventBus.on('panel.showBacteria', (payload) => {
            closeAllDevicePanels();
            setBacteriaDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for Grinder panel open
    useEffect(() => {
        return eventBus.on('panel.showGrinder', (payload) => {
            closeAllDevicePanels();
            setGrinderDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for Proof mastering suite panel open
    useEffect(() => {
        return eventBus.on('panel.showProof', (payload) => {
            closeAllDevicePanels();
            setProofDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for Yeast MIDI FX panel open
    useEffect(() => {
        return eventBus.on('panel.showYeast', () => {
            closeAllDevicePanels();
            setYeastOpen(true);
        });
    }, []);

    useEffect(() => {
        return eventBus.on('panel.showScoring', (payload) => {
            closeAllDevicePanels();
            setScoringDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for Crust limiter panel open
    useEffect(() => {
        return eventBus.on('panel.showCrust', (payload) => {
            closeAllDevicePanels();
            setCrustDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for Crumbs panel open
    useEffect(() => {
        return eventBus.on('panel.showCrumbs', (payload) => {
            closeAllDevicePanels();
            setSamplerDeviceId(payload.deviceId);
        });
    }, []);

    // Listen for Grand Boule panel open (from sidebar instrument click)
    useEffect(() => {
        return eventBus.on('panel.showGrandBoule', (payload) => {
            closeAllDevicePanels();
            setGrandBouleDeviceId(payload.deviceId);
        });
    }, []);

    // ─── Panel dimension setters (persisted via workspace store) ───
    const setSidebarWidth = (fn: (prev: number) => number) => updateWorkspaceState({ sidebarWidth: fn(sidebarWidth) });
    const setInspectorWidth = (fn: (prev: number) => number) =>
        updateWorkspaceState({ inspectorWidth: fn(inspectorWidth) });
    const setChatWidth = (fn: (prev: number) => number) => updateWorkspaceState({ chatPanelWidth: fn(chatWidth) });
    const setAiWidth = (fn: (prev: number) => number) => updateWorkspaceState({ aiPanelWidth: fn(aiWidth) });
    const setMixerHeight = (fn: (prev: number) => number) => updateWorkspaceState({ mixerHeight: fn(mixerHeight) });
    const setFermenterHeight = (fn: (prev: number) => number) =>
        updateWorkspaceState({ fermenterHeight: fn(fermenterHeight) });
    const setToasterHeight = (fn: (prev: number) => number) =>
        updateWorkspaceState({ toasterHeight: fn(toasterHeight) });
    const setLevainHeight = (fn: (prev: number) => number) => updateWorkspaceState({ levainHeight: fn(levainHeight) });
    const setGlutenHeight = (fn: (prev: number) => number) => updateWorkspaceState({ glutenHeight: fn(glutenHeight) });
    const setBacteriaHeight = (fn: (prev: number) => number) =>
        updateWorkspaceState({ bacteriaHeight: fn(bacteriaHeight) });
    const setGrinderHeight = (fn: (prev: number) => number) =>
        updateWorkspaceState({ grinderHeight: fn(grinderHeight) });
    const setProofChamberHeight = (fn: (prev: number) => number) =>
        updateWorkspaceState({ proofChamberHeight: fn(proofChamberHeight) });
    const setProofHeight = (fn: (prev: number) => number) => updateWorkspaceState({ proofHeight: fn(proofHeight) });
    const setScoringHeight = (fn: (prev: number) => number) =>
        updateWorkspaceState({ scoringHeight: fn(scoringHeight) });
    const setYeastHeight = (fn: (prev: number) => number) => updateWorkspaceState({ yeastHeight: fn(yeastHeight) });
    const setCrustHeight = (fn: (prev: number) => number) => updateWorkspaceState({ crustHeight: fn(crustHeight) });
    const setSamplerHeight = (fn: (prev: number) => number) =>
        updateWorkspaceState({ samplerHeight: fn(samplerHeight) });
    const setGrandBouleHeight = (fn: (prev: number) => number) =>
        updateWorkspaceState({ grandBouleHeight: fn(grandBouleHeight) });

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
            <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app">
                <a
                    href="#main-content"
                    className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
                >
                    Skip to content
                </a>
                <TransportBar />

                {/* ─── Main horizontal layout ─── */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Left dynamically placed panels */}
                    {prefs.panelPlacementSidebar === 'left' && sidebarOpen ? (
                        <>
                            <Sidebar style={{ width: sidebarWidth, minWidth: 180 }} />
                            <DragResizeHandle
                                side="right"
                                onResize={(d) => setSidebarWidth((w) => clamp(w + d, 180, 500))}
                            />
                        </>
                    ) : null}

                    {prefs.panelPlacementInspector === 'left' && inspectorOpen ? (
                        <>
                            <InspectorPanel style={{ width: inspectorWidth, minWidth: 200 }} />
                            <DragResizeHandle
                                side="right"
                                onResize={(d) => setInspectorWidth((w) => clamp(w + d, 200, 500))}
                            />
                        </>
                    ) : null}

                    {prefs.panelPlacementChat === 'left' && chatPanelOpen ? (
                        <>
                            <ChatPanel style={{ width: chatWidth, minWidth: 200 }} />
                            <DragResizeHandle
                                side="right"
                                onResize={(d) => setChatWidth((w) => clamp(w + d, 200, 600))}
                            />
                        </>
                    ) : null}

                    {prefs.panelPlacementAi === 'left' && aiPanelOpen ? (
                        <>
                            <div
                                className="flex flex-col border-r border-border-hairline bg-surface-tray overflow-hidden"
                                style={{ width: aiWidth, minWidth: 200 }}
                            >
                                <GenerativeAiPanel />
                            </div>
                            <DragResizeHandle
                                side="right"
                                onResize={(d) => setAiWidth((w) => clamp(w + d, 200, 500))}
                            />
                        </>
                    ) : null}

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
                                onClose={() => setFermenterDeviceId(null)}
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
                                onClose={() => setToasterDeviceId(null)}
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
                                onClose={() => setLevainOpen(false)}
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
                                onClose={() => setProofChamberDeviceId(null)}
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
                                onClose={() => setGlutenDeviceId(null)}
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
                                onClose={() => setBacteriaDeviceId(null)}
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
                                onClose={() => setGrinderDeviceId(null)}
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
                                onClose={() => setProofDeviceId(null)}
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
                                onClose={() => setScoringDeviceId(null)}
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
                                onClose={() => setYeastOpen(false)}
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
                                onClose={() => setCrustDeviceId(null)}
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
                                onClose={() => setSamplerDeviceId(null)}
                            >
                                <SamplerPanel deviceId={samplerDeviceId} />
                            </InstrumentBottomPanel>
                        ) : null}

                        {grandBouleDeviceId !== null ? (
                            <InstrumentBottomPanel
                                label="Grand Boule"
                                labelColor="text-amber-400"
                                borderColor="border-amber-500/20"
                                height={grandBouleHeight}
                                onResize={setGrandBouleHeight}
                                onClose={() => setGrandBouleDeviceId(null)}
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
                    {prefs.panelPlacementSidebar === 'right' && sidebarOpen ? (
                        <>
                            <DragResizeHandle
                                side="left"
                                onResize={(d) => setSidebarWidth((w) => clamp(w + d, 180, 500))}
                            />
                            <Sidebar style={{ width: sidebarWidth, minWidth: 180 }} />
                        </>
                    ) : null}

                    {prefs.panelPlacementInspector === 'right' && inspectorOpen ? (
                        <>
                            <DragResizeHandle
                                side="left"
                                onResize={(d) => setInspectorWidth((w) => clamp(w + d, 200, 500))}
                            />
                            <InspectorPanel style={{ width: inspectorWidth, minWidth: 200 }} />
                        </>
                    ) : null}

                    {prefs.panelPlacementChat === 'right' && chatPanelOpen ? (
                        <>
                            <DragResizeHandle
                                side="left"
                                onResize={(d) => setChatWidth((w) => clamp(w + d, 200, 600))}
                            />
                            <ChatPanel style={{ width: chatWidth, minWidth: 200 }} />
                        </>
                    ) : null}

                    {prefs.panelPlacementAi === 'right' && aiPanelOpen ? (
                        <>
                            <DragResizeHandle side="left" onResize={(d) => setAiWidth((w) => clamp(w + d, 200, 500))} />
                            <div
                                className="flex flex-col border-l border-border-hairline bg-surface-tray overflow-hidden"
                                style={{ width: aiWidth, minWidth: 200 }}
                            >
                                <GenerativeAiPanel />
                            </div>
                        </>
                    ) : null}
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
                <AiActionHistoryPanel />
                <MixAnalysisPanel />
                <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
                <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
                <ShortcutCheatSheet />

                <AlphaNoticeDialog
                    open={showAlphaNotice}
                    onOpenChange={(open) => {
                        if (!open) {
                            localStorage.setItem('sourdaw-alpha-notice-dismissed', 'true');
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
