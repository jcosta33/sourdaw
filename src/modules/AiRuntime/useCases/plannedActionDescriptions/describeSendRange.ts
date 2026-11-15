import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

export function describeSendRange(
    action: Extract<AppAction, { type: 'automateSendRange' }>,
    context: ProjectContext
): string {
    const targetDescriptions = (action.payload.expectedSends ?? []).map((send) => {
        const track = context.tracks.find((candidate) => candidate.id === send.trackId);
        const lowered = send.level * 10 ** (-action.payload.reductionDb / 20);
        const target = track ? `"${track.name}" (${track.id})` : send.trackId;
        return `${target} ${String(send.level)}→${String(lowered)}`;
    });
    const busName = action.payload.busName ?? action.payload.busId;
    const range =
        action.payload.startBeat === undefined || action.payload.endBeat === undefined
            ? action.payload.sectionName
            : `${action.payload.sectionName} beats ${String(action.payload.startBeat)}–${String(action.payload.endBeat)}`;
    return `Lower sends to "${busName}" (${action.payload.busId}) by ${String(action.payload.reductionDb)} dB only in ${range}: ${targetDescriptions.join(', ')}`;
}
