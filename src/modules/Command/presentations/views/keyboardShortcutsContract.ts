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
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

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
