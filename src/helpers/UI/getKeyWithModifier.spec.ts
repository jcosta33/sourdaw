/* (c) Copyright Frontify Ltd., all rights reserved. */

import { describe, expect, it } from 'vitest';

import { getKeyWithModifier } from './getKeyWithModifier';

describe(getKeyWithModifier.name, () => {
    it.each([
        ['MacOs', 'MacIntel', { meta: '⌘K', opt: '⌥K', shift: '⇧K' }],
        ['Windows', 'Win32', { meta: 'Ctrl+K', opt: 'Alt+K', shift: 'Shift+K' }],
    ])('Modifier keys: %s', (_, platform, expected) => {
        Object.defineProperty(navigator, 'platform', {
            value: platform,
            configurable: true,
        });

        expect(getKeyWithModifier('K')).toEqual(expected);
    });
});
