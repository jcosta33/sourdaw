import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { findContextClip } from '../../transformers/findContextClip';

export function describeMovedClip(action: Extract<AppAction, { type: 'moveClip' }>, context: ProjectContext): string {
    const clip = findContextClip(context, action.payload.clipId);
    const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
    if (clip && track) {
        return `Move clip "${clip.name}" to track "${track.name}" at beat ${String(action.payload.startBeat)}`;
    }
    return `Move clip to beat ${String(action.payload.startBeat)}`;
}
