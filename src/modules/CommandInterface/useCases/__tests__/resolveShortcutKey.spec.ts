import { describe, expect, it } from 'vitest';

import { resolveShortcutKey } from '../resolveShortcutKey';

type Press = { key: string; code: string; shiftKey?: boolean; altKey?: boolean };

function press({ key, code, shiftKey = false, altKey = false }: Press) {
    return { key, code, shiftKey, altKey };
}

describe('resolveShortcutKey', () => {
    it.each([
        ['Option+D', press({ key: '∂', code: 'KeyD', altKey: true }), 'd'],
        ['Option+S', press({ key: 'ß', code: 'KeyS', altKey: true }), 's'],
        ['Option+I (dead key)', press({ key: 'Dead', code: 'KeyI', altKey: true }), 'i'],
        ['Option+]', press({ key: '‘', code: 'BracketRight', altKey: true }), ']'],
        ['Shift+1', press({ key: '!', code: 'Digit1', shiftKey: true }), '1'],
        ['Shift+,', press({ key: '<', code: 'Comma', shiftKey: true }), ','],
        ['Shift+-', press({ key: '_', code: 'Minus', shiftKey: true }), '-'],
    ])('reads %s from the physical key on the US fallback', (_label, keyPress, expected) => {
        expect(resolveShortcutKey(keyPress, null)).toBe(expected);
    });

    it('prefers the layout map over the US table for a modifier-altered key', () => {
        // AZERTY: the physical KeyQ key types `a`, and Option+A there reports `æ`.
        const azerty = new Map([['KeyQ', 'a']]);

        expect(resolveShortcutKey(press({ key: 'æ', code: 'KeyQ', altKey: true }), azerty)).toBe('a');
    });

    it('keeps the produced character for an unmodified press, so letters follow the layout', () => {
        // AZERTY again: the unmodified KeyQ press is `a`, never the US `q`.
        expect(resolveShortcutKey(press({ key: 'a', code: 'KeyQ' }), null)).toBe('a');
    });

    it('keeps the produced letter under Shift', () => {
        expect(resolveShortcutKey(press({ key: 'N', code: 'KeyN', shiftKey: true }), null)).toBe('N');
    });

    it('keeps a named key that no layout maps, modifiers or not', () => {
        expect(resolveShortcutKey(press({ key: 'Escape', code: 'Escape', shiftKey: true }), null)).toBe('Escape');
        expect(resolveShortcutKey(press({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }), null)).toBe(
            'ArrowLeft'
        );
    });
});
