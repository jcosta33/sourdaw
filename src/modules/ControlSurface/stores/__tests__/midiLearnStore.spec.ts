import { stringify } from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MidiLearnState } from '../midiLearnStore';

const STORAGE_KEY = 'sourdaw-midi-learn-mappings';

async function importFreshMidiLearnStore(): Promise<MidiLearnState | null> {
    vi.resetModules();
    const { midiLearnStore } = await import('../midiLearnStore');
    return midiLearnStore.value;
}

describe('midiLearnStore persistence (F-3)', () => {
    afterEach(() => {
        window.localStorage.clear();
        vi.resetModules();
    });

    it('hydrates learned mappings from localStorage on module load, surviving a reload', async () => {
        const persistedMapping = {
            id: 'midi-map-1',
            channel: 0,
            cc: 7,
            targetType: 'trackGain',
            trackId: 'track1',
            minValue: 0,
            maxValue: 1,
            scaleMode: 'log',
        };
        window.localStorage.setItem(
            STORAGE_KEY,
            stringify({ mappings: [persistedMapping], isLearning: false, learningTarget: null })
        );

        const state = await importFreshMidiLearnStore();

        expect(state?.mappings).toEqual([persistedMapping]);
    });

    it('never restores an armed learn session across a reload', async () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            stringify({
                mappings: [],
                isLearning: true,
                learningTarget: { targetType: 'trackGain', trackId: 'track1' },
            })
        );

        const state = await importFreshMidiLearnStore();

        expect(state?.isLearning).toBe(false);
        expect(state?.learningTarget).toBeNull();
    });

    it('drops malformed persisted mappings instead of surfacing broken entries', async () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            stringify({
                mappings: [{ id: 'ok', channel: 0, cc: 1, targetType: 'trackGain', trackId: 't1' }, { not: 'valid' }],
                isLearning: false,
                learningTarget: null,
            })
        );

        const state = await importFreshMidiLearnStore();

        expect(state?.mappings).toEqual([]);
    });

    it('hydrates to an empty mapping table when the persisted text is not valid superjson', async () => {
        window.localStorage.setItem(STORAGE_KEY, '{not valid superjson');

        const state = await importFreshMidiLearnStore();

        expect(state?.mappings).toEqual([]);
        expect(state?.isLearning).toBe(false);
    });

    it('writes learned mappings through to localStorage so a fresh module load sees them', async () => {
        const { midiLearnStore } = await import('../midiLearnStore');
        const mapping = {
            id: 'midi-map-2',
            channel: 1,
            cc: 74,
            targetType: 'deviceParam' as const,
            trackId: 'track1',
            deviceId: 'dev1',
            paramId: 'cutoff',
            minValue: 0,
            maxValue: 1,
        };

        midiLearnStore.set({ mappings: [mapping], isLearning: false, learningTarget: null });

        const rehydrated = await importFreshMidiLearnStore();
        expect(rehydrated?.mappings).toEqual([mapping]);
    });
});
