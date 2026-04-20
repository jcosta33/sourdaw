import { useEffect } from 'react';

import { handleKeydown } from '../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown';
import { handleKeyup } from '../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeyup';

export const useGlobalKeyboardShortcuts = (): void => {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            const shouldPreventDefault = handleKeydown({
                key: e.key,
                mod: e.metaKey || e.ctrlKey,
                shift: e.shiftKey,
                alt: e.altKey,
                repeat: e.repeat,
                isInput,
            });

            if (shouldPreventDefault) {
                e.preventDefault();
            }
        };

        const keyupHandler = (e: KeyboardEvent) => {
            handleKeyup(e.key);
        };

        window.addEventListener('keydown', handler);
        window.addEventListener('keyup', keyupHandler);

        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener('keyup', keyupHandler);
        };
    }, []);
};
