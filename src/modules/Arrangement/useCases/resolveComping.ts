import { type ResolvedClip } from '../models/ResolvedClip';
import { takeLaneStore } from '../stores/takeLaneStore';
import { type Clip } from '../models/Track';

import { liveTempoTimeline } from './liveTempoTimeline';
import { resolveCompingProgramme } from './comping/resolveCompingProgramme';

export function resolveClipsWithComping(trackId: string, clips: Clip[]): ResolvedClip[] {
    return resolveCompingProgramme(trackId, clips, takeLaneStore.value, liveTempoTimeline);
}
