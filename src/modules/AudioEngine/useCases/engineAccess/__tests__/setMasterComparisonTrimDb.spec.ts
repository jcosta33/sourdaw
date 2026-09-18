/**
 * The comparison trim offsets what the output plays at without moving the fader.
 *
 * The doubles are the two things the master writers actually write to: the Web
 * Audio engine's own fader and the native session's backend handle, the same
 * pair `setMasterGainValue.spec.ts` stands up. What matters here is the number
 * each one is handed, and what the trim reports when the fader has no headroom
 * left to deliver it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clampFaderGain, dbToGain, FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
} from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession } from '../../livePlayback/nativeLiveGraphSessionState';
import { masterGainState } from '../masterGainState';
import { setMasterComparisonTrimDb } from '../setMasterComparisonTrimDb';
import { setMasterGainValue } from '../setMasterGainValue';

const mocks = vi.hoisted(() => ({
    setMasterGain: vi.fn<(value: number) => void>(),
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: { setMasterGain: mocks.setMasterGain },
    ensureEngine: vi.fn(),
}));

const APPLIED: AudioGraphApplyResult = {
    acceptance: 'accepted',
    application: 'applied',
    runtimeRevision: 1,
    reports: [],
};

const apply = vi.fn<(batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult>>();

const backend: AudioGraphBackend = {
    backendId: 'spec-double',
    apply: (batch) => apply(batch),
    dispose: () => undefined,
};

/** The level the Web Audio engine was last handed. */
function engineLevel(): number {
    const last = mocks.setMasterGain.mock.calls.at(-1);
    return last ? last[0] : Number.NaN;
}

beforeEach(() => {
    mocks.setMasterGain.mockReset();
    apply.mockReset();
    apply.mockResolvedValue(APPLIED);
    // Module state, process-wide by design: a case inheriting the previous
    // one's trim would measure an offset it never asked for.
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.pending = Promise.resolve();
    masterGainState.gain = 0.8;
    masterGainState.comparisonTrim = 1;
});

afterEach(() => {
    masterGainState.comparisonTrim = 1;
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.pending = Promise.resolve();
});

describe('setMasterComparisonTrimDb', () => {
    // Turns red if `setMasterComparisonTrimDb` hands `masterGainState.gain` to
    // the engine instead of the trimmed level: the engine would receive 0.5.
    it('offsets the monitored level by the decibels asked for while the fader has headroom', () => {
        masterGainState.gain = 0.5;

        const trim = setMasterComparisonTrimDb(6);

        expect(engineLevel()).toBeCloseTo(0.5 * dbToGain(6), 6);
        expect(trim.limited).toBe(false);
        expect(trim.appliedDb).toBeCloseTo(6, 6);
    });

    // Turns red if the native forward sends `masterGainState.gain` instead of
    // the effective level: the session carrying the strips would receive 0.5
    // and go on playing at the untrimmed level while the Web Audio strips
    // followed the match, which is the very offset the comparison is judged on.
    it('states the trimmed level to the session carrying the strips', async () => {
        nativeLiveGraphSession.backend = backend;
        masterGainState.gain = 0.5;

        setMasterComparisonTrimDb(6);
        await nativeLiveGraphSession.pending;

        expect(apply.mock.calls.map(([batch]) => batch.commands)).toEqual([
            [{ kind: 'set-master-gain', gain: clampFaderGain(0.5 * dbToGain(6)) }],
        ]);
    });

    // Turns red if the clamp is dropped from `effectiveMasterGain`: the engine
    // would receive 1.5 * dbToGain(6) ≈ 2.993, above the fader's own ceiling,
    // and `appliedDb` would report the full 6 dB the output never produced.
    it('reports the offset the fader ceiling actually delivered', () => {
        masterGainState.gain = 1.5;

        const trim = setMasterComparisonTrimDb(6);

        expect(engineLevel()).toBe(FADER_MAX_GAIN);
        expect(trim.limited).toBe(true);
        expect(trim.appliedDb).toBeCloseTo(20 * Math.log10(FADER_MAX_GAIN / 1.5), 6);
    });

    // Turns red if `setMasterGainValue` hands the bare clamped gesture to the
    // engine again: the engine would receive 0.4 with a +6 dB trim standing.
    it('keeps the fader gesture on the fader and the trim on the output', () => {
        setMasterComparisonTrimDb(6);

        setMasterGainValue(0.4);

        expect(engineLevel()).toBeCloseTo(0.4 * dbToGain(6), 6);
        expect(masterGainState.gain).toBe(0.4);
    });

    // Turns red if clearing the trim leaves the previous multiplier standing:
    // the engine would keep receiving 0.8 * dbToGain(6) after the zero.
    it('returns the output to the bare fader level when the trim is cleared', () => {
        setMasterComparisonTrimDb(6);

        const trim = setMasterComparisonTrimDb(0);

        expect(engineLevel()).toBeCloseTo(0.8, 6);
        expect(trim.appliedDb).toBeCloseTo(0, 6);
        expect(trim.limited).toBe(false);
    });
});
