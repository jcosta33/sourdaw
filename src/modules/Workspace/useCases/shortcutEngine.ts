import { inject } from '#/infra/di/inject';
import { type KeyBinding, type ShortcutAction, shortcutStore } from '../models/Shortcuts';
import {
    duplicateClipToNextBar,
    undo,
    redo,
} from '#/modules/Command/useCases';
import {
    togglePlayback,
    stopPlayback,
    toggleRecording,
    toggleLoop,
} from '#/modules/Transport/useCases';
import { copySelectedClip, pasteClip, removeClip } from '#/modules/Arrangement/useCases';
import { saveProject } from '#/modules/Project';
import { toggleMixer } from './togglePanel/panelToggles/toggleMixer';
import { toggleInspector } from './togglePanel/panelToggles/toggleInspector';
import { toggleChatPanel } from './togglePanel/panelToggles/toggleChatPanel';
import { workspaceStore } from '../stores/workspaceStore';
import { eventBus } from '#/app/registerDependencies';

type ShortcutHandler = (e: KeyboardEvent) => void;

const actionHandlers: Partial<Record<ShortcutAction, ShortcutHandler>> = {
    PLAY_PAUSE: (e) => {
        e.preventDefault();
        togglePlayback();
    },
    STOP_RETURN: (e) => {
        e.preventDefault();
        stopPlayback();
    },
    RECORD_TOGGLE: (e) => {
        e.preventDefault();
        toggleRecording();
    },
    LOOP_TOGGLE: (e) => {
        e.preventDefault();
        toggleLoop();
    },
    UNDO: (e) => {
        e.preventDefault();
        undo();
    },
    REDO: (e) => {
        e.preventDefault();
        redo();
    },
    COPY: (e) => {
        e.preventDefault();
        copySelectedClip();
    },
    PASTE: (e) => {
        e.preventDefault();
        pasteClip();
    },
    DELETE: (e) => {
        const ws = workspaceStore.value;
        if (!ws) {
            return;
        }
        const ids = ws.selectedClipIds.length > 0 ? ws.selectedClipIds : ws.selectedClipId ? [ws.selectedClipId] : [];
        if (ids.length > 0) {
            e.preventDefault();
            for (const id of ids) {
                removeClip(id);
            }
            workspaceStore.set({ ...ws, selectedClipId: null, selectedClipIds: [] });
        }
    },
    DUPLICATE: (e) => {
        e.preventDefault();
        const clipId = workspaceStore.value?.selectedClipId;
        if (clipId) {
            duplicateClipToNextBar(clipId);
        }
    },
    SAVE_PROJECT: (e) => {
        e.preventDefault();
        saveProject();
    },
    TOGGLE_MIXER: (e) => {
        e.preventDefault();
        toggleMixer();
    },
    TOGGLE_INSPECTOR: (e) => {
        e.preventDefault();
        toggleInspector();
    },
    TOGGLE_AI_ASSISTANT: (e) => {
        e.preventDefault();
        toggleChatPanel();
    },
};

export const startShortcutEngine = inject({ eventBus })(
    ({ eventBus }) =>
        (function startShortcutEngine(): () => void {
            // Cache Object.entries(bindings) so we don't allocate a new array on
            // every keydown. Invalidated via store subscription when bindings change.
            let cachedBindings: unknown = null;
            let cachedEntries: [string, KeyBinding][] = [];

            const unsub = shortcutStore.subscribe((state) => {
                if (state?.bindings !== cachedBindings) {
                    cachedBindings = state?.bindings ?? null;
                    cachedEntries = state ? (Object.entries(state.bindings) as [string, KeyBinding][]) : [];
                }
            });

            // Initialise from current value
            const initial = shortcutStore.value;
            if (initial) {
                cachedBindings = initial.bindings;
                cachedEntries = Object.entries(initial.bindings) as [string, KeyBinding][];
            }

            const handleGlobalKeyDown = (e: KeyboardEvent) => {
                if (
                    ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) ||
                    (e.target as HTMLElement).isContentEditable
                ) {
                    return;
                }

                if (cachedEntries.length === 0) {
                    return;
                }

                for (const [action, binding] of cachedEntries) {
                    const matchesKey = e.key.toLowerCase() === binding.key.toLowerCase();
                    const matchesMeta = !!binding.metaKey === e.metaKey;
                    const matchesCtrl = !!binding.ctrlKey === e.ctrlKey;
                    const matchesAlt = !!binding.altKey === e.altKey;
                    const matchesShift = !!binding.shiftKey === e.shiftKey;

                    if (matchesKey && matchesMeta && matchesCtrl && matchesAlt && matchesShift) {
                        const handler = actionHandlers[action as ShortcutAction];
                        if (handler) {
                            handler(e);
                            eventBus.emit('shortcut.fired', { action });
                            return; // Stop processing other keys
                        }
                    }
                }
            };

            window.addEventListener('keydown', handleGlobalKeyDown);
            return () => {
                window.removeEventListener('keydown', handleGlobalKeyDown);
                unsub();
            };
        })
);
