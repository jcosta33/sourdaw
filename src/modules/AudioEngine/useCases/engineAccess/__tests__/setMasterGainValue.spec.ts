/**
 * The master fader reaches both carriers (#3596).
 *
 * The doubles are the two things this use case actually writes to: the Web
 * Audio engine's own fader and the native session's backend handle. A
 * native-carried strip never crosses the Web Audio master node, so a fader
 * gesture that reached only the first double would move half the mix.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
} from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from '../../livePlayback/nativeLiveGraphSessionState';
import { masterGainState } from '../masterGainState';
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

/** The batches the session's backend was actually handed. */
function appliedBatches(): AudioGraphCommandBatch[] {
    return apply.mock.calls.map(([batch]) => batch);
}

beforeEach(() => {
    mocks.setMasterGain.mockReset();
    apply.mockReset();
    apply.mockResolvedValue(APPLIED);
    // Module state, process-wide by design: a case inheriting the previous
    // one's session would send to a backend it never opened.
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.pending = Promise.resolve();
    masterGainState.gain = 0.8;
});

afterEach(() => {
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.pending = Promise.resolve();
});

describe('setMasterGainValue', () => {
    it('sends the level a live native session is carrying its strips at', async () => {
        nativeLiveGraphSession.backend = backend;

        setMasterGainValue(0.3);
        await nativeLiveGraphSession.pending;

        expect(mocks.setMasterGain).toHaveBeenCalledWith(0.3);
        expect(appliedBatches()).toEqual([{ schemaVersion: 1, commands: [{ kind: 'set-master-gain', gain: 0.3 }] }]);
    });

    it('moves the Web Audio fader and sends nothing when no native session is open', async () => {
        setMasterGainValue(0.3);
        await nativeLiveGraphSession.pending;

        expect(mocks.setMasterGain).toHaveBeenCalledWith(0.3);
        expect(apply).not.toHaveBeenCalled();
    });

    // The native registry applies batches in arrival order, so a fader write
    // that overtook the topology batch still in flight would reach an engine
    // whose strips do not exist yet.
    it('waits behind whatever the session already has in flight', async () => {
        let releaseFirst = (): void => undefined;
        const first = new Promise<void>((resolve) => {
            releaseFirst = () => {
                resolve();
            };
        });
        nativeLiveGraphSession.backend = backend;
        nativeLiveGraphSession.pending = first;

        setMasterGainValue(0.3);
        await Promise.resolve();
        expect(apply).not.toHaveBeenCalled();

        releaseFirst();
        await nativeLiveGraphSession.pending;

        expect(appliedBatches()).toHaveLength(1);
    });

    // A drag produces gestures faster than a bridge round trip completes. The
    // level is read on the queue, so the backlog collapses onto the fader's
    // current position instead of replaying the positions it passed through.
    it('states the level the fader now holds from every forward waiting behind a blocked queue', async () => {
        let releaseFirst = (): void => undefined;
        const first = new Promise<void>((resolve) => {
            releaseFirst = () => {
                resolve();
            };
        });
        nativeLiveGraphSession.backend = backend;
        nativeLiveGraphSession.pending = first;

        setMasterGainValue(0.3);
        setMasterGainValue(0.6);
        releaseFirst();
        await nativeLiveGraphSession.pending;

        expect(appliedBatches().map((batch) => batch.commands)).toEqual([
            [{ kind: 'set-master-gain', gain: 0.6 }],
            [{ kind: 'set-master-gain', gain: 0.6 }],
        ]);
    });

    // A session start runs on this same chain and publishes its handle only at
    // the end of its turn, after its topology batch has already read the level.
    // A gesture during that start therefore sees no session, and deciding
    // before the queue would drop it: the take would run with the native strips
    // at the level the start opened at until the fader next moved.
    it('lands a gesture made during a session start behind that start', async () => {
        let openSession = (): void => undefined;
        const started = new Promise<void>((resolve) => {
            openSession = () => {
                resolve();
            };
        });
        void queueOnNativeLiveGraphSession(async () => {
            await started;
            nativeLiveGraphSession.backend = backend;
        });

        setMasterGainValue(0.4);
        openSession();
        await nativeLiveGraphSession.pending;

        expect(appliedBatches()).toEqual([{ schemaVersion: 1, commands: [{ kind: 'set-master-gain', gain: 0.4 }] }]);
    });

    it('states one clamped level to both carriers', async () => {
        nativeLiveGraphSession.backend = backend;

        setMasterGainValue(9);
        await nativeLiveGraphSession.pending;

        expect(mocks.setMasterGain).toHaveBeenCalledWith(FADER_MAX_GAIN);
        expect(appliedBatches()[0]?.commands).toEqual([{ kind: 'set-master-gain', gain: FADER_MAX_GAIN }]);
    });

    it('reads a negative or non-finite gesture as silence rather than as a phase inversion', async () => {
        nativeLiveGraphSession.backend = backend;

        setMasterGainValue(Number.NaN);
        await nativeLiveGraphSession.pending;
        setMasterGainValue(-2);
        await nativeLiveGraphSession.pending;

        expect(mocks.setMasterGain.mock.calls).toEqual([[0], [0]]);
        expect(appliedBatches().map((batch) => batch.commands)).toEqual([
            [{ kind: 'set-master-gain', gain: 0 }],
            [{ kind: 'set-master-gain', gain: 0 }],
        ]);
    });

    // The next session start states the level from here, so a gesture that
    // moved the fader without recording it would open the following session at
    // the level before the drag.
    it('records the level the next session start will open at', () => {
        setMasterGainValue(0.45);

        expect(masterGainState.gain).toBe(0.45);
    });
});
