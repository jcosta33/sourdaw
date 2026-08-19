import { describe, it, expect } from 'vitest';

import {
    FALLBACK_PEER_COLOR,
    isAcceptablePeerId,
    MAX_PEER_ID_LEN,
    MAX_PEER_NAME_LEN,
    sanitizePeerColor,
    sanitizePeerName,
} from '../CollaborationTypes';

describe('sanitizePeerName', () => {
    it('passes a name inside the bound through untouched', () => {
        expect(sanitizePeerName('José')).toBe('José');
    });

    it('truncates a name past the bound', () => {
        expect(sanitizePeerName('x'.repeat(500))).toHaveLength(MAX_PEER_NAME_LEN);
    });

    it('drops a trailing lone high surrogate rather than storing broken UTF-16', () => {
        // The emoji's high surrogate sits on the last accepted code unit and
        // its low surrogate on the first rejected one, so a plain slice cuts
        // the pair in half. A lone high surrogate is not well-formed UTF-16
        // and renders as U+FFFD in the peer list and presence overlay.
        const name = `${'a'.repeat(MAX_PEER_NAME_LEN - 1)}😀tail`;
        expect(name.slice(0, MAX_PEER_NAME_LEN).isWellFormed()).toBe(false);

        const sanitized = sanitizePeerName(name);

        expect(sanitized.isWellFormed()).toBe(true);
        expect(sanitized).toBe('a'.repeat(MAX_PEER_NAME_LEN - 1));
    });

    it('keeps a whole surrogate pair that ends exactly on the bound', () => {
        const name = `${'a'.repeat(MAX_PEER_NAME_LEN - 2)}😀tail`;

        const sanitized = sanitizePeerName(name);

        expect(sanitized).toHaveLength(MAX_PEER_NAME_LEN);
        expect(sanitized.isWellFormed()).toBe(true);
        expect(sanitized.endsWith('😀')).toBe(true);
    });
});

describe('sanitizePeerColor', () => {
    it('accepts a palette hex color unchanged', () => {
        expect(sanitizePeerColor('#3b82f6')).toBe('#3b82f6');
    });

    it('accepts the hsl overflow form unchanged', () => {
        expect(sanitizePeerColor('hsl(138, 70%, 55%)')).toBe('hsl(138, 70%, 55%)');
    });

    it('replaces anything that is not a well-formed CSS color with the fallback', () => {
        expect(sanitizePeerColor('url(javascript:alert(1))')).toBe(FALLBACK_PEER_COLOR);
        expect(sanitizePeerColor('#3b82f6, red); background: url(x')).toBe(FALLBACK_PEER_COLOR);
    });
});

describe('isAcceptablePeerId', () => {
    it('accepts the UUID this app mints', () => {
        expect(isAcceptablePeerId('0f9a5f2c-2a35-4a1c-9f0d-8a4f7f3c1b22')).toBe(true);
    });

    it('accepts an id exactly on the bound and rejects one past it', () => {
        expect(isAcceptablePeerId('x'.repeat(MAX_PEER_ID_LEN))).toBe(true);
        expect(isAcceptablePeerId('x'.repeat(MAX_PEER_ID_LEN + 1))).toBe(false);
    });
});
