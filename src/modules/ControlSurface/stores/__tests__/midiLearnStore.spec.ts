import { describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { MIDI_LEARN_MAPPINGS_SCHEMA_VERSION, defaultMidiLearnState, sanitizeMidiLearnState } from '../midiLearnStore';

describe('sanitizeMidiLearnState (audit A-1 / A-2)', () => {
    it('resets non-object persisted state to the default (empty) table', () => {
        expect(sanitizeMidiLearnState('corrupt')).toEqual(defaultMidiLearnState);
    });

    it('never restores an armed learn session across a hydrate', () => {
        const state = sanitizeMidiLearnState({
            mappingsSchemaVersion: MIDI_LEARN_MAPPINGS_SCHEMA_VERSION,
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        expect(state.isLearning).toBe(false);
        expect(state.learningTarget).toBeNull();
    });

    it('preserves a genuinely valid mapping while dropping a genuinely malformed one', () => {
        const validMapping = {
            id: 'ok',
            channel: 0,
            cc: 1,
            targetType: 'trackGain',
            trackId: 't1',
            minValue: 0,
            maxValue: 1,
        };
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

        const state = sanitizeMidiLearnState({
            mappingsSchemaVersion: MIDI_LEARN_MAPPINGS_SCHEMA_VERSION,
            mappings: [validMapping, { not: 'valid' }],
            isLearning: false,
            learningTarget: null,
        });

        expect(state.mappings).toEqual([validMapping]);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Discarding 1 invalid MIDI Learn mapping'));

        warnSpy.mockRestore();
    });

    it('drops every mapping when none validate, logging the rejection', () => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

        const state = sanitizeMidiLearnState({
            mappingsSchemaVersion: MIDI_LEARN_MAPPINGS_SCHEMA_VERSION,
            mappings: [{ not: 'valid' }, { also: 'bad' }],
            isLearning: false,
            learningTarget: null,
        });

        expect(state.mappings).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Discarding 2 invalid MIDI Learn mapping'));

        warnSpy.mockRestore();
    });

    it('hydrates to an empty mapping table when the persisted value has no mappings array', () => {
        const state = sanitizeMidiLearnState({ mappingsSchemaVersion: MIDI_LEARN_MAPPINGS_SCHEMA_VERSION });

        expect(state.mappings).toEqual([]);
        expect(state.isLearning).toBe(false);
    });

    it('refuses a mapping table stamped with a newer schema version than this build supports, preserving the version marker', () => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const futureVersion = MIDI_LEARN_MAPPINGS_SCHEMA_VERSION + 1;

        const state = sanitizeMidiLearnState({
            mappingsSchemaVersion: futureVersion,
            mappings: [{ id: 'future', channel: 0, cc: 1, targetType: 'trackGain', minValue: 0, maxValue: 1 }],
            isLearning: false,
            learningTarget: null,
        });

        expect(state.mappings).toEqual([]);
        expect(state.mappingsSchemaVersion).toBe(futureVersion);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('newer than this build supports'));

        warnSpy.mockRestore();
    });
});
