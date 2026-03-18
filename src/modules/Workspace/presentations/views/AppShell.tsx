import { type ReactElement, type ReactNode, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { TransportBar } from './TransportBar';
import { Sidebar } from './Sidebar';
import { InspectorPanel } from './InspectorPanel';
import { ChatPanel } from '#/modules/AiRuntime/presentations/views/ChatPanel';
import { MixerPanel } from './MixerPanel';
import { AutomationView } from './AutomationView';
import { ResizeHandle } from '../components/ResizeHandle';
import { CommandPalette } from '#/modules/Command/presentations/views/CommandPalette';
import { VoiceCommandOverlay } from '#/modules/AiRuntime/presentations/views/VoiceCommandOverlay';
import { AiChangeToast } from '#/modules/AiRuntime/presentations/views/AiChangeToast';
import { NotificationToast } from '../components/NotificationToast';
import { AiActionHistoryPanel } from '#/modules/AiRuntime/presentations/views/AiActionHistoryPanel';
import { MixAnalysisPanel } from '#/modules/AiRuntime/presentations/views/MixAnalysisPanel';
import { ExportDialog } from '#/modules/Project/presentations/views/ExportDialog';
import { PreferencesDialog } from '../components/PreferencesDialog';
import { useGlobalKeyboardShortcuts } from '../hooks/useGlobalKeyboardShortcuts';
import { initializeAudioEngine } from '../../useCases/workspaceViewActions';
import { initWebMidi } from '../../useCases/workspaceViewActions';
import { loadProject, saveProject, newProject } from '../../useCases/workspaceViewActions';
import { undo, redo } from '../../useCases/workspaceViewActions';
import { copySelectedClip, cutSelectedClip, pasteClip } from '../../useCases/workspaceViewActions';
import { removeClip } from '../../useCases/workspaceViewActions';
import { importMidiFile } from '../../useCases/workspaceViewActions';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import {
    toggleChatPanel,
    toggleSidebar,
    toggleInspector,
    toggleMixer,
    toggleAutomationPanel,
    toggleTrackList,
} from '#/modules/Workspace/useCases/togglePanel';
import { StatusBar } from './StatusBar';
import { ShortcutCheatSheet } from '../components/ShortcutCheatSheet';
import { UndoHistoryPanel } from '#/modules/Command/presentations/views/UndoHistoryPanel';
import { cn } from '#/helpers/Styles/cn';

const CollaborationPanelLazy = lazy(() =>
    import('#/modules/Collaboration/presentations/views/CollaborationPanel').then((m) => ({
        default: m.CollaborationPanel,
    }))
);

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 400;
const INSPECTOR_MIN = 180;
const INSPECTOR_MAX = 500;
const CHAT_MIN = 300;
const CHAT_MAX = 600;
const MIXER_MIN = 120;
const MIXER_MAX = 800;
const AUTO_PANEL_MIN = 250;
const AUTO_PANEL_MAX = 800;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

type AppShellProps = {
    children: ReactNode;
};

export const AppShell = ({ children }: AppShellProps): ReactElement => {
    const {
        sidebarOpen,
        inspectorOpen,
        mixerOpen,
        automationPanelOpen,
        automationPanelWidth,
        sidebarWidth,
        inspectorWidth,
        mixerHeight,
        collaborationPanelOpen,
        chatPanelOpen,
        chatPanelWidth,
    } = useWorkspaceState();
    const [exportOpen, setExportOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);

    const [localSidebarWidth, setLocalSidebarWidth] = useState(sidebarWidth);
    const [localInspectorWidth, setLocalInspectorWidth] = useState(inspectorWidth);
    const [localMixerHeight, setLocalMixerHeight] = useState(mixerHeight);
    const [localChatPanelWidth, setLocalChatPanelWidth] = useState(chatPanelWidth);
    const [localAutoPanelWidth, setLocalAutoPanelWidth] = useState(automationPanelWidth);

    const sidebarRef = useRef(localSidebarWidth);
    const inspectorRef = useRef(localInspectorWidth);
    const mixerRef = useRef(localMixerHeight);
    const chatPanelRef = useRef(localChatPanelWidth);
    const autoPanelRef = useRef(localAutoPanelWidth);

    useEffect(() => {
        setLocalSidebarWidth(sidebarWidth);
    }, [sidebarWidth]);
    useEffect(() => {
        setLocalInspectorWidth(inspectorWidth);
    }, [inspectorWidth]);
    useEffect(() => {
        setLocalMixerHeight(mixerHeight);
    }, [mixerHeight]);
    useEffect(() => {
        setLocalChatPanelWidth(chatPanelWidth);
    }, [chatPanelWidth]);
    useEffect(() => {
        setLocalAutoPanelWidth(automationPanelWidth);
    }, [automationPanelWidth]);

    const handleSidebarResize = (delta: number) => {
        setLocalSidebarWidth((prev) => {
            const next = clamp(prev + delta, SIDEBAR_MIN, SIDEBAR_MAX);
            sidebarRef.current = next;
            return next;
        });
    };
    const handleSidebarResizeEnd = () => {
        const ws = workspaceStore.value;
        if (ws) {
            workspaceStore.set({ ...ws, sidebarWidth: sidebarRef.current });
        }
    };

    const handleInspectorResize = (delta: number) => {
        setLocalInspectorWidth((prev) => {
            const next = clamp(prev + delta, INSPECTOR_MIN, INSPECTOR_MAX);
            inspectorRef.current = next;
            return next;
        });
    };
    const handleInspectorResizeEnd = () => {
        const ws = workspaceStore.value;
        if (ws) {
            workspaceStore.set({ ...ws, inspectorWidth: inspectorRef.current });
        }
    };

    const handleChatPanelResize = (delta: number) => {
        setLocalChatPanelWidth((prev) => {
            const next = clamp(prev - delta, CHAT_MIN, CHAT_MAX);
            chatPanelRef.current = next;
            return next;
        });
    };
    const handleChatPanelResizeEnd = () => {
        const ws = workspaceStore.value;
        if (ws) {
            workspaceStore.set({ ...ws, chatPanelWidth: chatPanelRef.current });
        }
    };

    const handleMixerResize = (delta: number) => {
        setLocalMixerHeight((prev) => {
            const next = clamp(prev - delta, MIXER_MIN, MIXER_MAX);
            mixerRef.current = next;
            return next;
        });
    };
    const handleMixerResizeEnd = () => {
        const ws = workspaceStore.value;
        if (ws) {
            workspaceStore.set({ ...ws, mixerHeight: mixerRef.current });
        }
    };

    const handleAutoPanelResize = (delta: number) => {
        setLocalAutoPanelWidth((prev) => {
            const next = clamp(prev - delta, AUTO_PANEL_MIN, AUTO_PANEL_MAX);
            autoPanelRef.current = next;
            return next;
        });
    };
    const handleAutoPanelResizeEnd = () => {
        const ws = workspaceStore.value;
        if (ws) {
            workspaceStore.set({ ...ws, automationPanelWidth: autoPanelRef.current });
        }
    };

    useGlobalKeyboardShortcuts();

    const audioInitialized = useRef(false);
    useEffect(() => {
        const init = () => {
            if (!audioInitialized.current) {
                audioInitialized.current = true;
                void initializeAudioEngine();
                void initWebMidi();
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
                toggleAutomationPanel();
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

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-base">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
            >
                Skip to content
            </a>
            <TransportBar />

            <div className="flex flex-1 overflow-hidden">
                {sidebarOpen && (
                    <>
                        <Sidebar style={{ width: localSidebarWidth }} />
                        <ResizeHandle
                            direction="vertical"
                            onResize={handleSidebarResize}
                            onResizeEnd={handleSidebarResizeEnd}
                        />
                    </>
                )}

                {inspectorOpen && (
                    <>
                        <InspectorPanel style={{ width: localInspectorWidth }} />
                        <ResizeHandle
                            direction="vertical"
                            onResize={handleInspectorResize}
                            onResizeEnd={handleInspectorResizeEnd}
                        />
                    </>
                )}

                <main id="main-content" className={cn('flex-1 overflow-hidden', 'border-x border-border/50')}>
                    {children}
                </main>

                {automationPanelOpen && (
                    <>
                        <ResizeHandle
                            direction="vertical"
                            onResize={handleAutoPanelResize}
                            onResizeEnd={handleAutoPanelResizeEnd}
                        />
                        <div
                            className="overflow-hidden border-l border-border/50"
                            style={{ width: localAutoPanelWidth }}
                        >
                            <AutomationView />
                        </div>
                    </>
                )}

                {chatPanelOpen && (
                    <>
                        <ResizeHandle
                            direction="vertical"
                            onResize={handleChatPanelResize}
                            onResizeEnd={handleChatPanelResizeEnd}
                        />
                        <ChatPanel style={{ width: localChatPanelWidth }} />
                    </>
                )}
            </div>

            {mixerOpen && (
                <>
                    <ResizeHandle
                        direction="horizontal"
                        onResize={handleMixerResize}
                        onResizeEnd={handleMixerResizeEnd}
                    />
                    <MixerPanel style={{ height: localMixerHeight }} />
                </>
            )}

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
        </div>
    );
};
