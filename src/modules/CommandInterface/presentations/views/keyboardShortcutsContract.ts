import { useEffect } from 'react';

import { getHandlerMap } from '#/modules/Command/stores';
import { projectLoadFailureStore, projectStore } from '#/modules/Project/stores';

import { isKeyboardEditableTarget } from '../../useCases/isKeyboardEditableTarget';
import { isWithinModalSurface } from '../../useCases/isWithinModalSurface';
import {
    handleKeydown,
    type KeyTarget,
} from '../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown';
import { handleKeyup } from '../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeyup';

function resolveKeyTarget(isTextEntry: boolean, target: EventTarget | null): KeyTarget {
    if (isTextEntry) {
        return 'textEntry';
    }
    return target instanceof Element && target.closest('[data-canvas-editor]') !== null ? 'noteEditor' : 'workspace';
}

function shouldDispatchShortcutAppActions(): boolean {
    if (projectLoadFailureStore.value !== null) {
        return false;
    }
    // First paint and iframe remount mount AppShell while bootstrap is still
    // importing WASM and the command-handler map is empty. Space would then
    // call executeAppAction and throw AppActionNotDispatchedError.
    if (projectStore.value?.loading !== false) {
        return false;
    }
    return Object.keys(getHandlerMap()).length > 0;
}

function preservesNativeTabTraversal(event: KeyboardEvent): boolean {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) {
        return false;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    // The focused DOM surface keeps its unmodified Tab traversal instead of
    // treating Tab as workspace mode. That covers the focused piano-roll
    // canvas, which leaves the canvas for its toolbar and automation tray,
    // and an overflow scrollport Chromium focuses natively with tabIndex -1.
    // An unfocused canvas (the arrangement timeline) is never the active
    // element, so Tab over it still toggles the workspace.
    if (
        target === target.ownerDocument.activeElement &&
        target !== target.ownerDocument.body &&
        target !== target.ownerDocument.documentElement
    ) {
        return true;
    }
    return (
        target instanceof HTMLButtonElement ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLAnchorElement && target.hasAttribute('href')) ||
        target.isContentEditable ||
        target.getAttribute('contenteditable') === 'true' ||
        target.tabIndex >= 0
    );
}

function preservesNativeButtonActivation(event: KeyboardEvent): boolean {
    if (
        (event.key !== 'Enter' && event.key !== ' ') ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
    ) {
        return false;
    }
    const target = event.target;
    return target instanceof HTMLButtonElement && target.ownerDocument.activeElement === target;
}

/**
 * View-layer keyboard shortcut contract exposed to other modules.
 */
export const useGlobalKeyboardShortcuts = (): void => {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (preservesNativeTabTraversal(event) || preservesNativeButtonActivation(event)) {
                return;
            }
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
            if (!shouldDispatchShortcutAppActions()) {
                return;
            }

            // A focused editor claims the keys it handles by calling
            // `preventDefault` in its own handler (the piano roll canvas does,
            // for Delete / Backspace and its note edits). React's root listener
            // runs before this bubbling `window` listener, so the flag is
            // visible here; a claimed key is the editor's alone and must not
            // also reach a global shortcut such as arrangement clip-delete.
            // Keys the editor does not claim (undo, redo, Space, save, ...)
            // keep routing globally, as in every other DAW's note editor.
            //
            // Not covered by a claim, by design:
            //   • Elastic editor — its Delete is a `window` listener and its
            //     canvas is not focusable, so no React handler can claim it.
            //     Its double-fire with the global clip-delete needs a
            //     different mechanism — see
            //     FINDING-inventory-decisions-backlog.md (#21 residual).
            //   • Mixer — has no keyboard Delete of its own, so claiming
            //     would disable delete with no replacement (same finding).
            if (event.defaultPrevented) {
                return;
            }

            const target = event.target as HTMLElement;

            // A portaled modal or menu surface owns the keyboard while focus is
            // inside it (#3618). Radix marks its Dialog/Popover content with
            // `role="dialog"` and its DropdownMenu content with `role="menu"`,
            // and the hand-rolled portals (dialogService overlays, context
            // menus) mark the same roles; Radix also moves focus into the
            // surface on open. Without this gate an unhandled Delete /
            // Backspace falls through to this window listener and deletes the
            // selected arrangement clips behind the surface with no
            // confirmation. Gate the whole layer exactly like a text input —
            // a modal is no more a shortcut context than an input is, so the
            // one `allowedInInput` exception (Cmd+K palette summon) applies
            // here too, as it already does inside a dialog's own inputs.
            // A native select owns Home, End, Space, and arrow navigation just
            // like a text field. Keep this adapter-local so native Edit routing
            // retains its narrower shared editable-target contract.
            const isTextEntry =
                target instanceof HTMLSelectElement ||
                isKeyboardEditableTarget(target) ||
                isWithinModalSurface(event.target);
            // A focused canvas editor (`data-canvas-editor`) keeps only the
            // editor-safe global shortcuts; see NOTE_EDITOR_SHORTCUT_IDS.
            const keyTarget = resolveKeyTarget(isTextEntry, target);

            const shouldPreventDefault = handleKeydown({
                key: event.key,
                mod: event.metaKey || event.ctrlKey,
                shift: event.shiftKey,
                alt: event.altKey,
                repeat: event.repeat,
                keyTarget,
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
