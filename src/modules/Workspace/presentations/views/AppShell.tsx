import {
    type ReactElement,
    type ReactNode,
    lazy,
    Suspense,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { useProjectState } from '../hooks/useProjectState';
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

import { CommandPalette } from '#/modules/Command/presentations/views/CommandPalette';
import { VoiceCommandOverlay } from '#/modules/AiRuntime/presentations/views/VoiceCommandOverlay';
import { AiChangeToast } from '#/modules/AiRuntime/presentations/views/AiChangeToast';
import { NotificationToast } from '../components/NotificationToast';
import { AiActionHistoryPanel } from '#/modules/AiRuntime/presentations/views/AiActionHistoryPanel';
import { MixAnalysisPanel } from '#/modules/AiRuntime/presentations/views/MixAnalysisPanel';
import { subscribeGenerativeAi, getGenerativeAiSnapshot } from '#/modules/AiGeneration/useCases/generativeAiActions';
import { ExportDialog } from '#/modules/Project/presentations/views/ExportDialog';
import { PreferencesDialog } from '../components/PreferencesDialog';
import { useGlobalKeyboardShortcuts } from '#/modules/Command/presentations/views/keyboardShortcutsContract';
import { startShortcutEngine } from '../../useCases/shortcutEngine';
import { initializeAudioEngine } from '#/modules/AudioEngine/useCases/initializeAudioEngine';
import { registerBuiltinPlugins } from '#/modules/Plugin/useCases/wamPluginHost';
import { registerBuiltinFaustDSP } from '#/modules/Plugin/useCases/faustEngine';
import { registerProModulationEffects } from '#/modules/Plugin/useCases/proModulationEffects';
import { registerProSynthInstruments } from '#/modules/Synth/useCases/proSynthInstruments';
import { initWebMidi } from '#/modules/AudioEngine/useCases/webMidiInput';
import { loadProject } from '#/modules/Project/useCases/projectPersistence/loadProject';
import { saveProject } from '#/modules/Project/useCases/projectPersistence/saveProject';
import { newProject } from '#/modules/Project/useCases/projectPersistence/newProject';
import { undo, redo } from '#/modules/Command/useCases/undoRedo';
import { copySelectedClip } from '#/modules/Arrangement/useCases/clipboardUseCases/copySelectedClip';
import { cutSelectedClip } from '#/modules/Arrangement/useCases/clipboardUseCases/cutSelectedClip';
import { pasteClip } from '#/modules/Arrangement/useCases/clipboardUseCases/pasteClip';
import { removeClip } from '#/modules/Arrangement/useCases/clipUseCases/removeClip';
import { importMidiFile } from '#/modules/MIDI/useCases/importMidiFile';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import {
    toggleChatPanel,
    toggleSidebar,
    toggleInspector,
    toggleMixer,
    toggleTrackList,
} from '#/modules/Workspace/useCases/togglePanel';
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
    const {
        sidebarOpen,
        inspectorOpen,
        mixerOpen,
        collaborationPanelOpen,
        chatPanelOpen,
        selectedClipId,
    } = useWorkspaceState();

    const project = useProjectState();
    const aiState = useSyncExternalStore(subscribeGenerativeAi, getGenerativeAiSnapshot);
    const aiPanelOpen = aiState.isPanelOpen;
    const [exportOpen, setExportOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [bottomTab, setBottomTab] = useState<'editor' | 'mixer' | 'session' | 'routing' | 'analysis' | 'automation'>('mixer');

    // Auto-switch bottom tab when clip selected
    useEffect(() => {
        if (selectedClipId) {
            setBottomTab('editor');
            const ws = workspaceStore.value;
            if (ws && !ws.mixerOpen) {
                workspaceStore.set({ ...ws, mixerOpen: true });
            }
        }
    }, [selectedClipId]);

    // Listen for automation tab activation (from 'A' key)
    useEffect(() => {
        const handler = () => {
            setBottomTab('automation');
            const ws = workspaceStore.value;
            if (ws && !ws.mixerOpen) {
                workspaceStore.set({ ...ws, mixerOpen: true });
            }
        };
        document.addEventListener('webdaw:show-automation-tab', handler);
        return () => document.removeEventListener('webdaw:show-automation-tab', handler);
    }, []);

    useGlobalKeyboardShortcuts();

    useEffect(() => {
        const cleanup = startShortcutEngine();
        return cleanup;
    }, []);

    const audioInitialized = useRef(false);
    useEffect(() => {
        const init = () => {
            if (!audioInitialized.current) {
                audioInitialized.current = true;
                void initializeAudioEngine();
                void initWebMidi();
                registerBuiltinPlugins();
                registerBuiltinFaustDSP();
                registerProModulationEffects();
                registerProSynthInstruments();
            }
        };
        window.addEventListener('click', init, { once: true });
        window.addEventListener('keydown', init, { once: true });
        return () => {
            window.removeEventListener('click', init);
            window.removeEventListener('keydown', init);
        };
    }, []);

    useEffect(() => {
        void loadProject();
    }, []);

    useEffect(() => {
        const handleKeys = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key === 'b' && !e.shiftKey) {
                e.preventDefault();
                toggleSidebar();
            }
            if (mod && e.key === 'i' && !e.shiftKey) {
                e.preventDefault();
                toggleInspector();
            }
            if (mod && e.key === 'm' && !e.shiftKey) {
                e.preventDefault();
                toggleMixer();
            }
            if (mod && e.shiftKey && e.key === 'a') {
                e.preventDefault();
                document.dispatchEvent(new Event('webdaw:show-automation-tab'));
            }
            if (mod && e.key === 'j') {
                e.preventDefault();
                toggleChatPanel();
            }
            if (mod && e.key === 't' && !e.shiftKey) {
                e.preventDefault();
                toggleTrackList();
            }
            if (mod && e.key === 's' && !e.shiftKey) {
                e.preventDefault();
                saveProject();
            }
            if (mod && e.shiftKey && e.key === 'e') {
                e.preventDefault();
                setExportOpen(true);
            }
            if (mod && e.key === ',') {
                e.preventDefault();
                setPrefsOpen(true);
            }
            if (mod && e.key === 'c' && !e.shiftKey) {
                const el = document.activeElement;
                if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                    return;
                }
                e.preventDefault();
                copySelectedClip();
            }
            if (mod && e.key === 'x' && !e.shiftKey) {
                const el = document.activeElement;
                if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                    return;
                }
                e.preventDefault();
                cutSelectedClip();
            }
            if (mod && e.key === 'v' && !e.shiftKey) {
                const el = document.activeElement;
                if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                    return;
                }
                e.preventDefault();
                pasteClip();
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.shiftKey) {
                const el = document.activeElement;
                if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                    return;
                }
                const ws = workspaceStore.value;
                if (!ws) {
                    return;
                }
                const ids =
                    ws.selectedClipIds.length > 0 ? ws.selectedClipIds : ws.selectedClipId ? [ws.selectedClipId] : [];
                if (ids.length > 0) {
                    e.preventDefault();
                    for (const id of ids) {
                        removeClip(id);
                    }
                    workspaceStore.set({ ...ws, selectedClipId: null, selectedClipIds: [] });
                }
            }
        };
        window.addEventListener('keydown', handleKeys);
        return () => window.removeEventListener('keydown', handleKeys);
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            saveProject();
        }, 30_000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const exportHandler = () => setExportOpen(true);
        const prefsHandler = () => setPrefsOpen(true);
        const saveHandler = () => saveProject();
        const newHandler = () => {
            newProject();
            window.location.reload();
        };
        const undoHandler = () => {
            void undo();
        };
        const redoHandler = () => {
            void redo();
        };
        const midiImportHandler = (e: Event) => {
            const file = (e as CustomEvent<File>).detail;
            if (file) {
                void importMidiFile(file);
            }
        };
        document.addEventListener('webdaw:open-export', exportHandler);
        document.addEventListener('webdaw:open-preferences', prefsHandler);
        document.addEventListener('webdaw:save-project', saveHandler);
        document.addEventListener('webdaw:new-project', newHandler);
        document.addEventListener('webdaw:undo', undoHandler);
        document.addEventListener('webdaw:redo', redoHandler);
        document.addEventListener('webdaw:import-midi', midiImportHandler);
        return () => {
            document.removeEventListener('webdaw:open-export', exportHandler);
            document.removeEventListener('webdaw:open-preferences', prefsHandler);
            document.removeEventListener('webdaw:save-project', saveHandler);
            document.removeEventListener('webdaw:new-project', newHandler);
            document.removeEventListener('webdaw:undo', undoHandler);
            document.removeEventListener('webdaw:redo', redoHandler);
            document.removeEventListener('webdaw:import-midi', midiImportHandler);
        };
    }, []);

    // ─── Panel width state (pixels, clamped) ───
    const [sidebarWidth, setSidebarWidth] = useState(280);
    const [inspectorWidth, setInspectorWidth] = useState(260);

    const [chatWidth, setChatWidth] = useState(320);
    const [aiWidth, setAiWidth] = useState(340);
    const [mixerHeight, setMixerHeight] = useState(300);

    const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

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
                {sidebarOpen && (
                    <>
                        <Sidebar style={{ width: sidebarWidth, minWidth: 180 }} />
                        <DragResizeHandle
                            side="right"
                            onResize={(d) => setSidebarWidth((w) => clamp(w + d, 180, 500))}
                        />
                    </>
                )}

                {/* Inspector (left of tracks) */}
                {inspectorOpen && (
                    <>
                        <InspectorPanel style={{ width: inspectorWidth, minWidth: 200 }} />
                        <DragResizeHandle
                            side="right"
                            onResize={(d) => setInspectorWidth((w) => clamp(w + d, 200, 500))}
                        />
                    </>
                )}

                {/* Center: vertical split — arrangement over mixer */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {/* Main arrangement area */}
                    <main id="main-content" className="contain-strict flex-1 overflow-hidden min-h-0">
                        {children}
                    </main>

                    {/* Mixer bottom panel */}
                    {mixerOpen && (
                        <>
                            <DragResizeHandle
                                side="top"
                                onResize={(d) => setMixerHeight((h) => clamp(h + d, 120, 800))}
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
                                        className={bottomTab === 'automation' ? 'text-[var(--color-accent-lavender)]' : ''}
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
                                        className={bottomTab === 'analysis' ? 'text-[var(--color-accent-lavender)]' : ''}
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
                    )}
                </div>


                {chatPanelOpen && (
                    <>
                        <DragResizeHandle side="left" onResize={(d) => setChatWidth((w) => clamp(w + d, 200, 600))} />
                        <ChatPanel style={{ width: chatWidth, minWidth: 200 }} />
                    </>
                )}

                {aiPanelOpen && (
                    <>
                        <DragResizeHandle side="left" onResize={(d) => setAiWidth((w) => clamp(w + d, 200, 500))} />
                        <div
                            className="flex flex-col border-l border-border-hairline bg-surface-tray overflow-hidden"
                            style={{ width: aiWidth, minWidth: 200 }}
                        >
                            <GenerativeAiPanel />
                        </div>
                    </>
                )}
            </div>

            <StatusBar />
            <UndoHistoryPanel />
            {collaborationPanelOpen && (
                <Suspense fallback={null}>
                    <CollaborationPanelLazy />
                </Suspense>
            )}

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
            {project.loading && (
                <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative size-12">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-sm font-medium text-foreground">
                                Loading Project
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {project.name}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
