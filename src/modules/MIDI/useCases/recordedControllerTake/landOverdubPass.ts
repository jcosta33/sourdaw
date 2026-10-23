import { logger } from '#/infra/logger/appLogger';
import { executeAppAction } from '#/modules/Command/useCases';
import { type OverdubControllerRowsSnapshot } from '#/utils/handlerContract';

import {
    type RecordedControllerBuffer,
    recordedControllerTakeState,
} from '../../repositories/webMidi/recordedControllerTakeState';

import { declareRegisteredStateInBuffer } from './declareRegisteredStateInBuffer';
import { planOverdubControllers } from './planOverdubControllers';
import { type RecordedClipSpan } from './planRecordedControllers';

/** One clip an overdub pass recorded into, with the buffer the pass took off the take state. */
export type DetachedOverdubClip = {
    clip: RecordedClipSpan;
    buffer: RecordedControllerBuffer;
};

function planPass(pass: readonly DetachedOverdubClip[]): OverdubControllerRowsSnapshot[] {
    const clips: OverdubControllerRowsSnapshot[] = [];
    for (const { clip, buffer } of pass) {
        declareRegisteredStateInBuffer({
            clipId: clip.id,
            buffer,
            takeStart: { cc: 0, pitchBend: 0 },
            seedRows: [],
        });
        const rows = planOverdubControllers({ clip, buffer });
        if (rows.cc.length > 0 || rows.pitchBend.length > 0) {
            clips.push({ clipId: clip.id, cc: rows.cc, pitchBend: rows.pitchBend });
        }
    }
    return clips;
}

async function land(pass: readonly DetachedOverdubClip[]): Promise<void> {
    try {
        const clips = planPass(pass);
        if (clips.length > 0) {
            await executeAppAction({ type: 'appendOverdubControllers', payload: { clips } });
        }
    } catch (error: unknown) {
        logger.warn('[MIDI] Recording the overdub controllers failed:', error);
    }
}

/**
 * Land the rows an overdub pass recorded as ONE undoable action, so Undo
 * removes the pass's controllers and bends together and Redo puts the same rows
 * back. A pass with no rows adds no history entry.
 *
 * Passes land one after another in the order they ended, and a pass plans its
 * registered-parameter declarations (`interleaveRegisteredStateDeclarations`)
 * only when its turn comes, against the rows the clip holds then: the action
 * waits behind the snapshot transaction queue, and an earlier pass that is
 * refused must leave no trace in the declarations of the next.
 *
 * A refused or failed pass is logged and dropped rather than thrown: the
 * caller is the transport stop, and a controller fault must not cost the
 * musician the notes of the take. The returned promise never rejects.
 */
export function landOverdubPass(pass: readonly DetachedOverdubClip[]): Promise<void> {
    if (pass.length === 0) {
        return Promise.resolve();
    }
    const landing = recordedControllerTakeState.overdubLanding.then(() => land(pass));
    recordedControllerTakeState.overdubLanding = landing;
    return landing;
}
