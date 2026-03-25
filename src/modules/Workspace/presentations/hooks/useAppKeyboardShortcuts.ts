import { useEffect } from 'react';
import { copySelectedClip } from '#/modules/Arrangement/useCases/clipboard/copySelectedClip';
import { cutSelectedClip } from '#/modules/Arrangement/useCases/clipboard/cutSelectedClip';
import { pasteClip } from '#/modules/Arrangement/useCases/clipboard/pasteClip';
import { removeClip } from '#/modules/Arrangement/useCases/clip/removeClip';
import { saveProject } from '#/modules/Project/useCases/projectPersistence/saveProject';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import {
    toggleChatPanel,
    toggleSidebar,
    toggleInspector,
    toggleMixer,
    toggleTrackList,
    clearClipSelection,
} from '#/modules/Workspace/useCases/togglePanel';

type ShortcutCallbacks = {
    onOpenExport: () => void;
    onOpenPreferences: () => void;
};

/**
 * Global keyboard shortcuts for panel toggles, clipboard, delete, save,
 * export, and preferences. Skips shortcuts when an input element is focused.
 */
export const useAppKeyboardShortcuts = ({ onOpenExport, onOpenPreferences }: ShortcutCallbacks): void => {
    useEffect(() => {
        const handleKeys = (e: KeyboardEvent): void => {
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
                onOpenExport();
            }
            if (mod && e.key === ',') {
                e.preventDefault();
                onOpenPreferences();
            }

            // Clipboard & delete — skip when in text inputs
            const el = document.activeElement;
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                return;
            }
            if (mod && e.key === 'c' && !e.shiftKey) {
                e.preventDefault();
                copySelectedClip();
            }
            if (mod && e.key === 'x' && !e.shiftKey) {
                e.preventDefault();
                cutSelectedClip();
            }
            if (mod && e.key === 'v' && !e.shiftKey) {
                e.preventDefault();
                pasteClip();
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.shiftKey) {
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
                    clearClipSelection();
                }
            }
        };
        window.addEventListener('keydown', handleKeys);
        return () => window.removeEventListener('keydown', handleKeys);
    }, [onOpenExport, onOpenPreferences]);
};
