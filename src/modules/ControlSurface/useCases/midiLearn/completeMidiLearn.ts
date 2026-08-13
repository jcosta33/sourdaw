import { inject } from '#/infra/di/inject';
import { executeAppAction } from '#/modules/Command/useCases';

import { midiLearnStore } from '../../stores/midiLearnStore';

/**
 * Complete an armed MIDI Learn by binding the next incoming CC to the target
 * that `startMidiLearn` armed.
 *
 * Dispatches `completeMidiLearn` through `executeAppAction` (audit A-1): a
 * learned mapping references a `trackId`/`deviceId`/`paramId` — project
 * entities — so it belongs in the Automerge document like every other
 * track/device binding, inside a transaction, on the undo stack. The actual
 * mutation lives in `handleCompleteMidiLearn`
 * (`handlers/midiLearn/handleRestoreMidiLearnMappings.ts`); this function
 * stays a thin dispatcher so its public signature — called synchronously
 * from `MIDI/useCases/webMidiInput/handleWebMidiCC.ts`, outside this
 * module's scope — never has to change.
 *
 * The pre-dispatch guard is a fast, side-effect-free early return: the real
 * MIDI module already gates this call on `learnState.isLearning` before
 * invoking it, and the handler re-checks authoritatively at execute time, so
 * this only avoids dispatching a no-op action when called directly (e.g.
 * from a test) without that upstream guard.
 */
export const completeMidiLearn = inject({ executeAppAction })(
    ({ executeAppAction }) =>
        function completeMidiLearn(channel: number, cc: number): void {
            const state = midiLearnStore.value;
            if (!state || !state.isLearning || !state.learningTarget) {
                return;
            }

            void executeAppAction({
                type: 'completeMidiLearn',
                payload: { channel, cc, mappingId: `midi-map-${crypto.randomUUID()}` },
            });
        }
);
