/* (c) Copyright Frontify Ltd., all rights reserved. */

import { useEffect, useRef } from 'react';

import { type EventListener, KeyPressNotifier, type HotKey } from '#/helpers/DOM/KeyPressNotifier';

export { type HotKey, type EventListener };

export function useKeyPressNotifier(hotkey?: HotKey, listener?: EventListener) {
    const keyPressNotifier = useRef(KeyPressNotifier.getInstance());

    useEffect(() => {
        if (!hotkey) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            keyPressNotifier.current.notify(event, listener);
        };

        window.addEventListener('keydown', handleKeyDown);
        const unsubscribe = keyPressNotifier.current.subscribe(hotkey, listener);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            unsubscribe();
        };
    }, [hotkey, listener]);
}
