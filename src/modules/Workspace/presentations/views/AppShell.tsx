import { type ReactElement, type ReactNode, lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { updateWorkspaceState } from '../../useCases/workspaceState';
import { useProjectState } from '../hooks/useProjectState';
import { useAppInitialization } from '../hooks/useAppInitialization';
import { useAppKeyboardShortcuts } from '../hooks/useAppKeyboardShortcuts';
import { useAppEventHandlers } from '../hooks/useAppEventHandlers';
import { APP_EVENTS } from '#/helpers/Event/appEvents';
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
import { ProofPanel } from '#/modules/Proof/presentations/views/ProofPanel';
import { ScoringPanel } from '#/modules/Scoring/presentations/views/ScoringPanel';
import { YeastPanel } from '#/modules/Yeast/presentations/views/YeastPanel';

import { CommandPalette } from '#/modules/Command/presentations/views/CommandPalette';
import { VoiceCommandOverlay } from '#/modules/AiRuntime/presentations/views/VoiceCommandOverlay';
import { AiChangeToast } from '#/modules/AiRuntime/presentations/views/AiChangeToast';
import { NotificationToast } from '../components/NotificationToast';
import { AiActionHistoryPanel } from '#/modules/AiRuntime/presentations/views/AiActionHistoryPanel';
import { MixAnalysisPanel } from '#/modules/AiRuntime/presentations/views/MixAnalysisPanel';
import { subscribeAiStore, getAiSnapshot } from '#/modules/AiGeneration/stores/aiStore';
import { ExportDialog } from '#/modules/Project/presentations/views/ExportDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { useGlobalKeyboardShortcuts } from '#/modules/Command/presentations/views/keyboardShortcutsContract';
import { startShortcutEngine } from '../../useCases/shortcutEngine';
import { openMixer } from '../../useCases/togglePanel/panelToggles';
import { StatusBar } from './StatusBar';
import { ShortcutCheatSheet } from '../components/ShortcutCheatSheet';
import { UndoHistoryPanel } from '#/modules/Command/presentations/views/UndoHistoryPanel';

import { Button } from '#/components/ui/button';
import { DragResizeHandle } from '#/components/ui/DragResizeHandle';

const CollaborationPanelLazy = lazy(() =>
    import('#/modules/Collaboration/presentations/views/CollaborationPanel').then((m) => ({
        default: m.CollaborationPanel,
    }))
);

type AppShellProps = {
    children: ReactNode;
};

export const AppShell = ({ children }: AppShellProps): ReactElement => {
    const workspaceState = useWorkspaceState();
    const {
        sidebarOpen,
        inspectorOpen,
        mixerOpen,
        collaborationPanelOpen,
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
        proofHeight,
        yeastHeight,
    } = workspaceState;

    const project = useProjectState();
    const aiState = useSyncExternalStore(subscribeAiStore, getAiSnapshot);
    const aiPanelOpen = aiState.isPanelOpen;
    const [exportOpen, setExportOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [bottomTab, setBottomTab] = useState<'editor' | 'mixer' | 'session' | 'routing' | 'analysis' | 'automation'>(
        'mixer'
    );
    const [fermenterOpen, setFermenterOpen] = useState(false);
    const [toasterOpen, setToasterOpen] = useState(false);
    const [levainOpen, setLevainOpen] = useState(false);
    const [proofChamberOpen, setProofChamberOpen] = useState(false);
    const [glutenOpen, setGlutenOpen] = useState(false);
    const [scoringOpen, setScoringOpen] = useState(false);
    const [proofOpen, setProofOpen] = useState(false);
    const [yeastOpen, setYeastOpen] = useState(false);

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

    // Auto-switch bottom tab when clip selected
    useEffect(() => {
        if (selectedClipId) {
            setBottomTab('editor');
            openMixer();
        }
    }, [selectedClipId]);

    // Listen for automation tab activation (from 'A' key)
    useEffect(() => {
        const handler = (): void => {
            setBottomTab('automation');
            if (!mixerOpen) {
                openMixer();
            }
        };
        document.addEventListener(APP_EVENTS.SHOW_AUTOMATION_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_AUTOMATION_TAB, handler);
    }, [mixerOpen]);

    // ─── Shared state helpers ───
    const closeAllDevicePanels = () => {
        setFermenterOpen(false);
        setToasterOpen(false);
        setLevainOpen(false);
        setProofChamberOpen(false);
        setGlutenOpen(false);
        setScoringOpen(false);
        setProofOpen(false);
        setYeastOpen(false);
    };

    // Listen for fermenter panel open (from inspector device click)
    useEffect(() => {
        const handler = (): void => {
            closeAllDevicePanels();
            setFermenterOpen(true);
        };
        document.addEventListener(APP_EVENTS.SHOW_FERMENTER_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_FERMENTER_TAB, handler);
    }, []);

    // Listen for toaster panel open (from inspector device click)
    useEffect(() => {
        const handler = (): void => {
            closeAllDevicePanels();
            setToasterOpen(true);
        };
        document.addEventListener(APP_EVENTS.SHOW_TOASTER_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_TOASTER_TAB, handler);
    }, []);

    // Listen for levain panel open (from inspector device click)
    useEffect(() => {
        const handler = (): void => {
            closeAllDevicePanels();
            setLevainOpen(true);
        };
        document.addEventListener(APP_EVENTS.SHOW_LEVAIN_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_LEVAIN_TAB, handler);
    }, []);

    // Listen for Dutch Oven panel open (from inspector device click)
    useEffect(() => {
        const handler = (): void => {
            closeAllDevicePanels();
            setProofChamberOpen(true);
        };
        document.addEventListener(APP_EVENTS.SHOW_PROOF_CHAMBER_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_PROOF_CHAMBER_TAB, handler);
    }, []);

    // Listen for Gluten panel open (from inspector device click)
    useEffect(() => {
        const handler = (): void => {
            closeAllDevicePanels();
            setGlutenOpen(true);
        };
        document.addEventListener(APP_EVENTS.SHOW_GLUTEN_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_GLUTEN_TAB, handler);
    }, []);

    // Listen for Proof mastering suite panel open
    useEffect(() => {
        const handler = (): void => {
            closeAllDevicePanels();
            setProofOpen(true);
        };
        document.addEventListener(APP_EVENTS.SHOW_PROOF_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_PROOF_TAB, handler);
    }, []);

    // Listen for Yeast MIDI FX panel open
    useEffect(() => {
        const handler = (): void => {
            closeAllDevicePanels();
            setYeastOpen(true);
        };
        document.addEventListener(APP_EVENTS.SHOW_YEAST_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_YEAST_TAB, handler);
    }, []);

    useEffect(() => {
        const handler = (): void => {
            closeAllDevicePanels();
            setScoringOpen(true);
        };
        document.addEventListener(APP_EVENTS.SHOW_SCORING_TAB, handler);
        return () => document.removeEventListener(APP_EVENTS.SHOW_SCORING_TAB, handler);
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
    const setProofHeight = (fn: (prev: number) => number) => updateWorkspaceState({ proofHeight: fn(proofHeight) });
    const setYeastHeight = (fn: (prev: number) => number) => updateWorkspaceState({ yeastHeight: fn(yeastHeight) });

    return (
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
                {/* Sidebar */}
                {sidebarOpen ? (
                    <>
                        <Sidebar style={{ width: sidebarWidth, minWidth: 180 }} />
                        <DragResizeHandle
                            side="right"
                            onResize={(d) => setSidebarWidth((w) => clamp(w + d, 180, 500))}
                        />
                    </>
                ) : null}

                {/* Inspector (left of tracks) */}
                {inspectorOpen ? (
                    <>
                        <InspectorPanel style={{ width: inspectorWidth, minWidth: 200 }} />
                        <DragResizeHandle
                            side="right"
                            onResize={(d) => setInspectorWidth((w) => clamp(w + d, 200, 500))}
                        />
                    </>
                ) : null}

                {/* Center: vertical split — arrangement over mixer */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {/* Main arrangement area */}
                    <main id="main-content" className="contain-strict flex-1 overflow-hidden min-h-0">
                        {children}
                    </main>

                    {fermenterOpen ? (
                        <InstrumentBottomPanel
                            label="Fermenter"
                            labelColor="text-[var(--color-accent-lavender)]"
                            borderColor="border-[var(--color-accent-lavender)]/20"
                            height={fermenterHeight}
                            onResize={setFermenterHeight}
                            onClose={() => setFermenterOpen(false)}
                        >
                            <FermenterPanel />
                        </InstrumentBottomPanel>
                    ) : null}

                    {toasterOpen ? (
                        <InstrumentBottomPanel
                            label="Toaster"
                            labelColor="text-[var(--color-accent-peach)]"
                            borderColor="border-[var(--color-accent-peach)]/20"
                            height={toasterHeight}
                            onResize={setToasterHeight}
                            onClose={() => setToasterOpen(false)}
                        >
                            <ToasterPanel />
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

                    {proofChamberOpen ? (
                        <InstrumentBottomPanel
                            label="Dutch Oven"
                            labelColor="text-[var(--color-accent-cyan)]"
                            borderColor="border-[var(--color-accent-cyan)]/20"
                            height={340}
                            onResize={() => {}}
                            onClose={() => setProofChamberOpen(false)}
                        >
                            <ProofChamberPanel />
                        </InstrumentBottomPanel>
                    ) : null}

                    {glutenOpen ? (
                        <InstrumentBottomPanel
                            label="Gluten"
                            labelColor="text-[var(--color-accent-peach)]"
                            borderColor="border-[var(--color-accent-peach)]/20"
                            height={glutenHeight}
                            onResize={setGlutenHeight}
                            onClose={() => setGlutenOpen(false)}
                        >
                            <GlutenPanel />
                        </InstrumentBottomPanel>
                    ) : null}

                    {proofOpen ? (
                        <InstrumentBottomPanel
                            label="Proof"
                            labelColor="text-[var(--color-accent-mint)]"
                            borderColor="border-[var(--color-accent-mint)]/20"
                            height={proofHeight}
                            onResize={setProofHeight}
                            onClose={() => setProofOpen(false)}
                        >
                            <ProofPanel />
                        </InstrumentBottomPanel>
                    ) : null}

                    {scoringOpen ? (
                        <InstrumentBottomPanel
                            label="Scoring"
                            labelColor="text-[var(--color-accent-mint)]"
                            borderColor="border-[var(--color-accent-mint)]/20"
                            height={280}
                            onResize={() => {}}
                            onClose={() => setScoringOpen(false)}
                        >
                            <ScoringPanel />
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
                                <div className="flex items-center gap-0.5 px-2 py-0.5 border-b border-black/40 bg-surface-app shrink-0">
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
                                        className={bottomTab === 'routing' ? 'text-[var(--color-accent-peach)]' : ''}
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
                </div>

                {chatPanelOpen ? (
                    <>
                        <DragResizeHandle side="left" onResize={(d) => setChatWidth((w) => clamp(w + d, 200, 600))} />
                        <ChatPanel style={{ width: chatWidth, minWidth: 200 }} />
                    </>
                ) : null}

                {aiPanelOpen ? (
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

            <CommandPalette />
            <VoiceCommandOverlay />
            <AiChangeToast />
            <NotificationToast />
            <AiActionHistoryPanel />
            <MixAnalysisPanel />
            <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
            <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
            <ShortcutCheatSheet />

            {/* Loading overlay */}
            {project.loading ? (
                <div
                    className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md"
                    aria-busy="true"
                    aria-live="polite"
                >
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative size-12">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-sm font-medium text-foreground">Loading Project</span>
                            <span className="text-xs text-muted-foreground">{project.name}</span>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
