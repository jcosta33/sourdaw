import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/** The loop length change, or `null` when no track holds the clip. */
export function describeClipLoopLength(
    action: Extract<AppAction, { type: 'setClipLoopLength' }>,
    context: ProjectContext
): string | null {
    for (const track of context.tracks) {
        const clip = track.clips.find((candidate) => candidate.id === action.payload.clipId);
        if (!clip) {
            continue;
        }
        const previous =
            clip.loopLength === undefined
                ? `the implicit clip duration of ${String(clip.endBeat - clip.startBeat)} beats`
                : `${String(clip.loopLength)} beats`;
        const loopState = clip.loopEnabled
            ? 'clip looping remains enabled'
            : 'clip looping remains disabled, so this stored length is dormant until looping is enabled';
        return `Set clip "${clip.name}" (${clip.id}) on track "${track.name}" (${track.id}) loop length from ${previous} to ${String(action.payload.loopLength)} beats; ${loopState}; clip range remains beats ${String(clip.startBeat)}–${String(clip.endBeat)}`;
    }
    return null;
}
