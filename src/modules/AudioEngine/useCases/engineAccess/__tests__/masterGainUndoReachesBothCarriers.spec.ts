/**
 * An undone master-gain move reaches both carriers (#3596).
 *
 * The fader has one public writer, `setMasterGainValue`, and every
 * action-sourced move of the master arrives through the same committed-write
 * seam: undo and redo, the command registry, the AI action, Auto-Fix Mix. A
 * route that reached the Web Audio engine directly would move the strips that
 * engine carries, leave the native-carried ones where the session opened them,
 * and leave the recorded level — what the next session start opens at — quoting
 * a position the fader no longer holds.
 *
 * Everything but the Web Audio engine and the native backend handle is the
 * shipping code: the real undo handler, the real guarded durable write, the real
 * store, and the real use case under it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
} from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession } from '../../livePlayback/nativeLiveGraphSessionState';
import { masterGainState } from '../masterGainState';

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

const MOVED_TO_PERCENT = 65;
const UNDONE_TO_PERCENT = 80;

beforeEach(() => {
    mocks.setMasterGain.mockReset();
    apply.mockReset();
    apply.mockResolvedValue(APPLIED);
    nativeLiveGraphSession.backend = backend;
    nativeLiveGraphSession.pending = Promise.resolve();
    masterGainState.gain = MOVED_TO_PERCENT / 100;
    transportStore.set({ ...defaultTransportState, masterGain: MOVED_TO_PERCENT });
});

describe('undoing a master-gain move', () => {
    it('states the restored level to the native session and records it', async () => {
        const result = await getTransportHandlers().restoreMasterGain.execute({
            type: 'restoreMasterGain',
            payload: { expectedPercent: MOVED_TO_PERCENT, replacementPercent: UNDONE_TO_PERCENT },
        });

        expect(result).toMatchObject({ status: 'written' });
        if (!result || !('afterCommit' in result)) {
            throw new Error('the undo must report a written result carrying its runtime reconciliation');
        }
        await result.afterCommit?.();
        await nativeLiveGraphSession.pending;

        const restoredGain = (transportStore.value?.masterGain ?? 0) / 100;
        expect(restoredGain).toBe(UNDONE_TO_PERCENT / 100);
        expect(mocks.setMasterGain).toHaveBeenCalledWith(restoredGain);
        expect(apply.mock.calls.map(([batch]) => batch.commands)).toEqual([
            [{ kind: 'set-master-gain', gain: restoredGain }],
        ]);
        expect(masterGainState.gain).toBe(restoredGain);
    });
});
