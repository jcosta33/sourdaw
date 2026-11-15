import { resolveSendLevelFields, SEND_LEVEL_LAW } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

import { formatDecibelsFromGain } from './formatDecibelsFromGain';
import { resolveActionTrackName } from './resolveActionTrackName';

export function describeExactAddedSend(
    action: Extract<AppAction, { type: 'addSend' }>,
    context: ProjectContext,
    actions: readonly AppAction[]
): string {
    const sourceName = resolveActionTrackName(action.payload.trackId, actions, context);
    const busName = resolveActionTrackName(action.payload.busId, actions, context);
    const tap = action.payload.preFader === true ? 'pre-fader' : 'post-fader';
    // The send does not exist yet, so a relative request is measured from
    // the full copy of the signal it taps, as the handler measures it.
    const level = resolveSendLevelFields(action.payload, SEND_LEVEL_LAW.unity);
    const at = level.ok ? ` at ${formatDecibelsFromGain(level.linear)}` : '';
    return `Create ${tap} send from "${sourceName}" (${action.payload.trackId}) to "${busName}" (${action.payload.busId})${at}`;
}
