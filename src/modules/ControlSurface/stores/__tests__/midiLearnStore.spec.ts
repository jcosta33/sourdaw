import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import {
    MIDI_LEARN_MAPPINGS_SCHEMA_VERSION,
    defaultMidiLearnState,
    midiLearnStore,
    sanitizeMidiLearnState,
} from '../midiLearnStore';

const fakeDoc: Record<string, unknown> = {};

describe('sanitizeMidiLearnState (audit A-1 / A-2)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        midiLearnStore.set(defaultMidiLearnState);
        flushAutomergeStorageWrites();
        for (const key of Object.keys(fakeDoc)) {
            delete fakeDoc[key];
        }
        configureAutomergeStoragePort({
            getDoc: () => fakeDoc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(fakeDoc),
        });
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it('preserves the active local learning target when its mapping commit is projected', () => {
        const learningTarget = { targetType: 'trackGain' as const, trackId: 'track-1' };
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            midiLearnStore.set({
                ...defaultMidiLearnState,
                isLearning: true,
                learningTarget,
            });
        });

        transaction.commit();

        expect(midiLearnStore.value?.isLearning).toBe(true);
        expect(midiLearnStore.value?.learningTarget).toEqual(learningTarget);
    });

    it('does not revive a learning target reset by hydration during an open commit', () => {
        const learningTarget = { targetType: 'trackGain' as const, trackId: 'track-1' };
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            midiLearnStore.set({ ...defaultMidiLearnState, isLearning: true, learningTarget });
        });
        fakeDoc.midiLearn = {
            mappingsSchemaVersion: MIDI_LEARN_MAPPINGS_SCHEMA_VERSION,
            mappings: [],
        };
        midiLearnStore.hydrate();
        expect(midiLearnStore.value?.isLearning).toBe(false);

        transaction.commit();

        expect(midiLearnStore.value?.isLearning).toBe(false);
        expect(midiLearnStore.value?.learningTarget).toBeNull();
    });
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
