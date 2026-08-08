/**
 * Voice stacking use case — unison with per-voice detuning and stereo spread.
 */

import { setCrumbsParamWithAudio } from './setCrumbsParamWithAudio';

import type { VoiceStackParams } from '../models/CrumbsTypes';

/**
 * Move one or more voice-stack controls.
 *
 * These three used to be the last Crumbs controls addressing only the *native*
 * `CrumbsInstance` behind `set_crumbs_param`. That instance is the
 * sample-acquisition and disk-streaming path — not the `crumbs-processor`
 * worklet summed into the track strip — so raising Voices to 4 stacked four
 * voices in an engine nobody was listening to, and the strip kept playing one.
 * `parse_crumbs_param` has accepted all three ids verbatim the whole time
 * (`crates/daw-dsp/src/crumbs/types.rs:339-341`); nothing was ever sending them
 * to the right place. `panelReachesTheEngine.spec.tsx` is the guard that sees
 * this, and it reduces to a one-line difference: `setCrumbsParamThrottled` alone
 * versus the shared knob path.
 *
 * That shared path is now the whole implementation. The three ids are declared
 * descriptor parameters, so `setCrumbsParamWithAudio` gives them everything the
 * other ten already had — the session store write that keeps the controlled
 * panel from snapping back mid-drag, the worklet write through
 * `updateDeviceParam`, the native write that keeps the recorder and the
 * streaming path in step, the declared-range clamp, and one undoable
 * `setDeviceParameter` per gesture rather than one per pointer sample.
 *
 * `isTransient` is threaded rather than dropped for that last reason. Without
 * it every pointer-move that crosses a step would open its own Automerge
 * transaction and its own undo entry — the "a drag is one edit, not ninety"
 * defect #1474 fixed for the other knobs, which these three still had because
 * their callback signature had nowhere to put the flag.
 *
 * Fields are addressed one at a time because `Device.parameterValues` is keyed
 * by parameter id; a combined update is three parameter writes, which is what a
 * combined update has always been on the wire.
 */
export function updateVoiceStack(instanceId: string, updates: Partial<VoiceStackParams>, isTransient = false): void {
    if (updates.stackCount !== undefined) {
        setCrumbsParamWithAudio(instanceId, 'stackCount', updates.stackCount, isTransient);
    }
    if (updates.detuneSpread !== undefined) {
        setCrumbsParamWithAudio(instanceId, 'detuneSpread', updates.detuneSpread, isTransient);
    }
    if (updates.stackSpread !== undefined) {
        setCrumbsParamWithAudio(instanceId, 'stackSpread', updates.stackSpread, isTransient);
    }
}
