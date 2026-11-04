import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

const capability = vi.hoisted(() => ({ hasMidiInput: true }));
vi.mock('#/utils/platformCapabilities', () => ({
    getPlatformCapabilities: () => capability,
}));

import { midiLearnStore, type LearningTarget } from '../../../stores/midiLearnStore';
import { MIDI_LEARN_TIMEOUT_MS, startMidiLearn } from '../startMidiLearn';

const target: LearningTarget = { targetType: 'trackGain', trackId: 'track1' };

describe('startMidiLearn', () => {
    beforeEach(() => {
        capability.hasMidiInput = true;
        midiLearnStore.set({ mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('arms learning for the given target', () => {
        startMidiLearn(target);

        expect(midiLearnStore.value?.isLearning).toBe(true);
        expect(midiLearnStore.value?.learningTarget).toEqual(target);
    });

    it('does nothing when the store has no state', () => {
        midiLearnStore.set(null);

        startMidiLearn(target);

        expect(midiLearnStore.value).toBeNull();
    });

    it('refuses an unsupported route before replacing an armed target or scheduling another timeout', () => {
        vi.useFakeTimers();
        startMidiLearn(target);
        const before = structuredClone(midiLearnStore.value);
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const infoSpy = vi.spyOn(logger, 'info');
        capability.hasMidiInput = false;

        startMidiLearn({ targetType: 'trackPan', trackId: 'track2' });

        expect(midiLearnStore.value).toEqual(before);
        expect(timeoutSpy).not.toHaveBeenCalled();
        expect(infoSpy).not.toHaveBeenCalled();
        timeoutSpy.mockRestore();
        infoSpy.mockRestore();
        vi.advanceTimersByTime(MIDI_LEARN_TIMEOUT_MS);
        expect(midiLearnStore.value?.isLearning).toBe(false);
    });

    it('auto-cancels an armed learn that receives no CC within the timeout (F-10)', () => {
        vi.useFakeTimers();

        startMidiLearn(target);
        expect(midiLearnStore.value?.isLearning).toBe(true);

        vi.advanceTimersByTime(MIDI_LEARN_TIMEOUT_MS);

        expect(midiLearnStore.value?.isLearning).toBe(false);
        expect(midiLearnStore.value?.learningTarget).toBeNull();
    });

    it('does not cancel a learn that already completed before the timeout fires', () => {
        vi.useFakeTimers();

        startMidiLearn(target);
        midiLearnStore.set({ ...midiLearnStore.value!, isLearning: false, learningTarget: null, mappings: [] });

        vi.advanceTimersByTime(MIDI_LEARN_TIMEOUT_MS);

        // Still false/null — the stale timeout must not resurrect learning state.
        expect(midiLearnStore.value?.isLearning).toBe(false);
    });

    it('does not cancel a newer learn session started after the first one', () => {
        vi.useFakeTimers();

        startMidiLearn(target);
        vi.advanceTimersByTime(MIDI_LEARN_TIMEOUT_MS / 2);

        const secondTarget: LearningTarget = { targetType: 'trackPan', trackId: 'track2' };
        startMidiLearn(secondTarget);

        // The first timeout fires now, but a second (different) learn is armed.
        vi.advanceTimersByTime(MIDI_LEARN_TIMEOUT_MS / 2);

        expect(midiLearnStore.value?.isLearning).toBe(true);
        expect(midiLearnStore.value?.learningTarget).toEqual(secondTarget);
    });
});
