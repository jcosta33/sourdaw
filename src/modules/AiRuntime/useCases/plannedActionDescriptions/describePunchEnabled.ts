import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

export function describePunchEnabled(
    action: Extract<AppAction, { type: 'setPunchEnabled' }>,
    context: ProjectContext
): string {
    const verb = action.payload.enabled ? 'Enable' : 'Disable';
    const region = `${String(context.punchInBeat)}–${String(context.punchOutBeat)}`;
    if (action.payload.enabled) {
        return `${verb} Transport Punch In/Out until changed; during playback with an armed track, recording starts at punch-in beat ${String(context.punchInBeat)} and stops at punch-out beat ${String(context.punchOutBeat)}; punch region remains beats ${region}; background capture is unchanged`;
    }
    return `${verb} Transport Punch In/Out until changed; armed-track playback will no longer start and stop recording at punch region beats ${region}; punch region remains beats ${region}; background capture is unchanged`;
}
