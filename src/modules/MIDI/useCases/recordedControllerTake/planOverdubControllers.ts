import { type RecordedControllerBuffer } from '../../repositories/webMidi/recordedControllerTakeState';
import { clipMediaOriginBeat } from '../../services/clipMediaOriginBeat';

import { planPedalLifts } from './planPedalLifts';
import { type RecordedClipSpan, type RecordedControllerPlan } from './planRecordedControllers';

type PlanOverdubControllersInput = {
    clip: RecordedClipSpan;
    buffer: Pick<RecordedControllerBuffer, 'cc' | 'pitchBend'>;
};

/**
 * The rows an overdub pass writes into `clip`: the buffered rows the pass took off
 * the take state, closed by a lift for each pedal it leaves engaged on the clip's
 * closing line. An overdub opened no clip, so it has no starting pedals or range
 * seed to lead with.
 */
export function planOverdubControllers({ clip, buffer }: PlanOverdubControllersInput): RecordedControllerPlan {
    const lifts = planPedalLifts({
        rows: buffer.cc,
        closingLineBeat: clip.endBeat - clipMediaOriginBeat(clip),
    });
    return { cc: [...buffer.cc, ...lifts], pitchBend: [...buffer.pitchBend] };
}
