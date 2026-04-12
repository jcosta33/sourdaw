import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createMidiError } from '../MidiError';

describe('createMidiError', () => {
    it('builds a tagged Midi AppError', () => {
        const err = createMidiError('bad note');
        expect(err._tag).toBe('Midi');
        expect(err.message).toBe('bad note');
        expect(isAppError(err)).toBe(true);
    });
});
