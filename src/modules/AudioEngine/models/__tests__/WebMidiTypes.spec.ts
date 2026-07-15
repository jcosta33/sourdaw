import { describe, expect, it } from 'vitest';

import { createWebMidiNoteKey } from '../WebMidiTypes';

describe('createWebMidiNoteKey', () => {
    it('gives the same pitch on different channels distinct stable identities', () => {
        expect(createWebMidiNoteKey(1, 60)).not.toBe(createWebMidiNoteKey(2, 60));
        expect(createWebMidiNoteKey(1, 60)).toBe(createWebMidiNoteKey(1, 60));
    });
});
