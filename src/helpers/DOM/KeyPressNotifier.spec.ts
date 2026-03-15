/* (c) Copyright Frontify Ltd., all rights reserved. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyPressNotifier } from './KeyPressNotifier';

describe(KeyPressNotifier.name, () => {
    const mockListener = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('MacOS', () => {
        beforeEach(() => {
            Object.defineProperty(navigator, 'platform', {
                value: 'MacIntel',
                configurable: true,
            });
        });
        it.each([
            ['Enter', { key: 'Enter' }],
            ['F', { key: 'F' }],
            ['Meta+D', { key: 'D', metaKey: true }],
            ['Meta+K', { key: 'K', metaKey: true }],
            ['Meta+Opt+K', { key: 'K', metaKey: true, altKey: true }],
            ['Opt+C', { key: 'C', metaKey: false, altKey: true }],
            ['Opt+V', { key: 'V', altKey: true }],
            ['Shift+Enter', { key: 'Enter', shiftKey: true }],
            ['Meta+Shift+T', { key: 'T', metaKey: true, shiftKey: true }],
            ['Meta+Shift+Opt+A', { key: 'A', metaKey: true, altKey: true, shiftKey: true }],
        ])('should subscribe a hotkey: %s', (hotKey, event) => {
            const keyPressNotifier = KeyPressNotifier.getInstance();
            keyPressNotifier.subscribe(hotKey, mockListener);
            keyPressNotifier.notify(new KeyboardEvent('keydown', event), mockListener);

            expect(mockListener).toHaveBeenCalledOnce();
        });

        it.each([
            [
                'Enter, F',
                [
                    { hotkey: 'Enter', listener: mockListener },
                    { hotkey: 'F', listener: mockListener },
                ],
                [{ key: 'Enter' }, { key: 'F' }],
                2,
            ],
            [
                'Meta+Opt+K, Meta+D',
                [
                    { hotkey: 'Meta+Opt+K', listener: mockListener },
                    { hotkey: 'Meta+D', listener: mockListener },
                ],
                [
                    { key: 'K', metaKey: true, altKey: true },
                    { key: 'D', metaKey: true },
                ],
                2,
            ],
            [
                'Opt+V, Shift+Enter, Meta+Shift+T',
                [
                    { hotkey: 'Opt+V', listener: mockListener },
                    { hotkey: 'Shift+Enter', listener: mockListener },
                    { hotkey: 'Meta+Shift+T', listener: mockListener },
                ],
                [
                    { key: 'V', altKey: true },
                    { key: 'Enter', shiftKey: true },
                    { key: 'T', metaKey: true, shiftKey: true },
                ],
                3,
            ],
        ])('subscribes array of hotKeys and Notifiers to a commands: %s', (_, hotKey, events, calledTimes) => {
            const keyPressNotifier = KeyPressNotifier.getInstance();
            keyPressNotifier.subscribe(hotKey);

            for (const event of events) {
                keyPressNotifier.notify(new KeyboardEvent('keydown', event), mockListener);
            }

            expect(mockListener).toHaveBeenCalledTimes(calledTimes);
        });
    });

    describe('Windows', () => {
        beforeEach(() => {
            Object.defineProperty(navigator, 'platform', {
                value: 'Win32',
                configurable: true,
            });
        });
        it.each([
            ['Enter', { key: 'Enter' }],
            ['F', { key: 'F' }],
            ['Meta+D', { key: 'D', ctrlKey: true }],
            ['Meta+K', { key: 'K', ctrlKey: true }],
            ['Meta+Opt+K', { key: 'K', ctrlKey: true, altKey: true }],
            ['Opt+C', { key: 'C', altKey: true }],
            ['Opt+V', { key: 'V', altKey: true }],
            ['Shift+Enter', { key: 'Enter', shiftKey: true }],
            ['Meta+Shift+T', { key: 'T', ctrlKey: true, shiftKey: true }],
            ['Meta+Shift+Opt+A', { key: 'A', ctrlKey: true, altKey: true, shiftKey: true }],
        ])('Windows: should subscribe a hotkey: %s', (hotKey, event) => {
            const keyPressNotifier = KeyPressNotifier.getInstance();
            keyPressNotifier.subscribe(hotKey, mockListener);
            keyPressNotifier.notify(new KeyboardEvent('keydown', event), mockListener);

            expect(mockListener).toHaveBeenCalledOnce();
        });
    });

    it('should allow an array of strings', () => {
        const keyPressNotifier = KeyPressNotifier.getInstance();
        keyPressNotifier.subscribe(['F', 'Enter'], mockListener);

        const eventF = { key: 'F' };
        keyPressNotifier.notify(new KeyboardEvent('keydown', eventF), mockListener);

        expect(mockListener).toHaveBeenCalledOnce();

        const eventEnter = { key: 'Enter' };
        keyPressNotifier.notify(new KeyboardEvent('keydown', eventEnter), mockListener);

        expect(mockListener).toHaveBeenCalledTimes(2);
    });

    it('does not notify because it is not keyboard event', () => {
        const keyPressNotifier = KeyPressNotifier.getInstance();

        keyPressNotifier.subscribe('Enter', mockListener);
        keyPressNotifier.notify(new MouseEvent('click') as unknown as KeyboardEvent, mockListener);

        expect(mockListener).not.toHaveBeenCalled();
    });

    it('triggers a keyboard event and prevents the default behavior when a listener for the key shortcut is present', () => {
        const mockPreventDefault = vi.fn();
        const event = new KeyboardEvent('keydown', { key: 'K', ctrlKey: true });
        Object.defineProperty(event, 'preventDefault', { value: mockPreventDefault });

        const keyPressNotifier = KeyPressNotifier.getInstance();
        keyPressNotifier.subscribe('Meta+K', mockListener);
        keyPressNotifier.notify(event, mockListener);

        expect(mockListener).toHaveBeenCalledOnce();
        expect(mockPreventDefault).toHaveBeenCalledOnce();
    });

    describe('Unsubscribing', () => {
        const keyPressNotifier = KeyPressNotifier.getInstance();

        it('unsubscribes a hotkey "U"', () => {
            const hotKey = 'U';

            keyPressNotifier.subscribe(hotKey, mockListener);
            keyPressNotifier.notify(new KeyboardEvent('keydown', { key: hotKey }), mockListener);

            expect(mockListener).toHaveBeenCalledOnce();

            keyPressNotifier.unsubscribe(hotKey);
            keyPressNotifier.notify(new KeyboardEvent('keydown', { key: hotKey }), mockListener);

            expect(mockListener).not.toHaveBeenCalledTimes(2);
        });

        it('unsubscribes a hotkey "Enter" with returned method', () => {
            const hotKey = 'Enter';

            const unsubscribe = keyPressNotifier.subscribe(hotKey, mockListener);
            keyPressNotifier.notify(new KeyboardEvent('keydown', { key: hotKey }), mockListener);

            expect(mockListener).toHaveBeenCalledOnce();

            unsubscribe();
            keyPressNotifier.notify(new KeyboardEvent('keydown', { key: hotKey }), mockListener);

            expect(mockListener).not.toHaveBeenCalledTimes(2);
        });

        it('unsubscribes a hotkey "Enter" with returned method', () => {
            const multipleHotKeys = [
                { hotkey: 'Meta+D', listener: mockListener },
                { hotkey: 'Opt+C', listener: mockListener },
            ];

            const unsubscribe = keyPressNotifier.subscribe(multipleHotKeys);
            keyPressNotifier.notify(new KeyboardEvent('keydown', { key: 'D', ctrlKey: true }), mockListener);
            keyPressNotifier.notify(new KeyboardEvent('keydown', { key: 'C', altKey: true }), mockListener);

            expect(mockListener).toHaveBeenCalledTimes(2);

            unsubscribe();
            keyPressNotifier.notify(new KeyboardEvent('keydown', { key: 'D', ctrlKey: true }), mockListener);
            keyPressNotifier.notify(new KeyboardEvent('keydown', { key: 'C', altKey: true }), mockListener);

            expect(mockListener).toHaveBeenCalledTimes(2);
        });
    });
});
