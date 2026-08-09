import { useEffect } from 'react';

import { projectLoadFailureStore } from '#/modules/Project/stores';

import { handleKeydown } from '../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown';
import { handleKeyup } from '../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeyup';

/**
 * View-layer keyboard shortcut contract exposed to other modules.
 */
export const useGlobalKeyboardShortcuts = (): void => {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            // A load that replaced the CRDT authority and then failed leaves the
            // stores holding an empty project while `projectStore` still carries
            // the *previous* project's `name`/`createdAt` — the metadata write
            // lives in the batch that never ran. Every global shortcut is still
            // reachable from the failure dialog, because its button is not an
            // input and not a canvas editor, and the worst of them is a save:
            // `saveProject` keys the recent entry off `project.createdAt`, so it
            // would serialise the emptied stores straight over the user's real
            // project. Nothing routes to the app until the session is replaced.
            //
            // Deliberately no `preventDefault` — the browser's own handling is
            // harmless here, and swallowing the event would also take the reload
            // that the failure surface tells the user to perform.
            if (projectLoadFailureStore.value !== null) {
                return;
            }

            const target = event.target as HTMLElement;
            // A *focusable* canvas editor that owns its destructive keys marks
            // its focused surface with `data-canvas-editor`. When the focused
            // element is inside one, gate the global shortcut layer exactly
            // like a text input so Delete / Backspace routes to that editor's
            // own delete instead of also firing the arrangement clip-delete.
            // Today only the PianoRoll canvas qualifies: it is `tabIndex`-
            // focusable and `handleKeyDown` deletes the selected notes, so the
            // focused canvas *is* `event.target`. The arrangement timeline is
            // not marked, so Delete there still reaches the clip-delete path.
            //
            // Not gated here, by design (this is a focus/target-based gate):
            //   • Elastic editor — its Delete is a `window` listener and its
            //     canvas is not focusable, so `event.target` is never inside
            //     it; a marker would be inert. Its double-fire with the global
            //     clip-delete needs a different mechanism — see
            //     FINDING-inventory-decisions-backlog.md (#21 residual).
            //   • Mixer — has no keyboard Delete of its own, so gating it would
            //     disable delete with no replacement (same finding).
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
