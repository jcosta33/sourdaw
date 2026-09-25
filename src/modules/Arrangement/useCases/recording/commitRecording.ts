import { executeAppAction } from '#/modules/Command/useCases';

import { type Clip } from '../../stores/trackStore';

/**
 * Commit one completed recording gesture as a single semantic unit.
 *
 * The recorder opens the clip, its take lane, and its takes provisionally while
 * capture runs; this dispatch is the only history the gesture creates, and it is
 * called only once the capture has completed. The registered `commitRecording`
 * handler writes the recorded clip inside the owning transaction and captures a
 * complete inverse (`discardRecording`) and explicit redo (`restoreRecording`),
 * so one undo removes the clip together with the takes that name it and one redo
 * restores the same clip identity, placement, and take membership.
 *
 * Deliberately `executeAppAction`, not `executeUserAppAction`: every caller
 * attaches its own rejection handler that retires the provisional recording and
 * tells the user, and the user-facing wrapper resolves a conflict-class refusal
 * (the project mutation gate, for one) after its own generic notice — which
 * would leave the staged clip, take, and notes behind with no entry and call it
 * a success (#4439). The wrapper keeps that behaviour for every other action.
 */
export async function commitRecording(clip: Clip): Promise<void> {
    await executeAppAction({ type: 'commitRecording', payload: { clip } });
}
