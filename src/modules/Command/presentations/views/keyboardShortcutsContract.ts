import { useEffect } from 'react';

import { handleKeydown } from '../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown';
import { handleKeyup } from '../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeyup';

/**
 * View-layer keyboard shortcut contract exposed to other modules.
 */
export const useGlobalKeyboardShortcuts = (): void => {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            // A canvas-based editor (PianoRoll / Elastic / Mixer) that handles
            // its own destructive keys advertises this by carrying a
            // `data-canvas-editor` attribute (matching the codebase's existing
            // `[data-*]` target-routing convention). When focus is inside one,
            // gate the global shortcut layer exactly like a text input so
            // Delete / Backspace routes to that editor's own note/marker delete
            // instead of also firing the arrangement clip-delete path. The
            // arrangement timeline surface is *not* marked, so Delete there
            // still reaches the global clip-delete shortcut.
            const isCanvasEditor = target.closest('[data-canvas-editor]') !== null;
            const isInput =
                isCanvasEditor ||
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable;

            const shouldPreventDefault = handleKeydown({
                key: event.key,
                mod: event.metaKey || event.ctrlKey,
                shift: event.shiftKey,
                alt: event.altKey,
                repeat: event.repeat,
                isInput,
            });

            if (shouldPreventDefault) {
                event.preventDefault();
            }
        };

        const keyupHandler = (event: KeyboardEvent) => {
            handleKeyup(event.key);
        };

        window.addEventListener('keydown', handler);
        window.addEventListener('keyup', keyupHandler);

        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener('keyup', keyupHandler);
        };
    }, []);
};
