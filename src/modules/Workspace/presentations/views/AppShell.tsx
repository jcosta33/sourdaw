import {
    type ReactElement,
    type ReactNode,
    lazy,
    Suspense,
    useEffect,
    useState,
    useSyncExternalStore,
} from 'react';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { useProjectState } from '../hooks/useProjectState';
import { useAppInitialization } from '../hooks/useAppInitialization';
import { useAppKeyboardShortcuts } from '../hooks/useAppKeyboardShortcuts';
import { useAppEventHandlers } from '../hooks/useAppEventHandlers';
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
import { PreferencesDialog } from './PreferencesDialog';
import { useGlobalKeyboardShortcuts } from '#/modules/Command/presentations/views/keyboardShortcutsContract';
import { startShortcutEngine } from '../../useCases/shortcutEngine';
import { openMixer } from '../../useCases/togglePanel';
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
            if (!mixerOpen) {
                openMixer();
            }
        }
    }, [selectedClipId, mixerOpen]);

    // Listen for automation tab activation (from 'A' key)
    useEffect(() => {
        const handler = (): void => {
            setBottomTab('automation');
            if (!mixerOpen) {
                openMixer();
            }
        };
        document.addEventListener('webdaw:show-automation-tab', handler);
        return () => document.removeEventListener('webdaw:show-automation-tab', handler);
    }, [mixerOpen]);

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

                    {/* Mixer bottom panel */}
                    {mixerOpen ? (
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
            ) : null}
        </div>
    );
};
