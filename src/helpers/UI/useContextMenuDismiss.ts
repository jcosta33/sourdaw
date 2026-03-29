import { type RefObject, useEffect } from 'react';

/**
 * Closes a context menu when the user clicks outside it or presses Escape.
 */
export const useContextMenuDismiss = (ref: RefObject<HTMLDivElement | null>, onClose: () => void): void => {
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [ref, onClose]);
};
