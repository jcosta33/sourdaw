import { type ResolvedClip } from '../models/ResolvedClip';
import { type Clip } from '../models/Track';
import { takeLaneStore } from '../stores/takeLaneStore';

import { resolveCompingProgramme } from './comping/resolveCompingProgramme';
import { liveTempoTimeline } from './liveTempoTimeline';

export function resolveClipsWithComping(trackId: string, clips: Clip[]): ResolvedClip[] {
    return resolveCompingProgramme(trackId, clips, takeLaneStore.value, liveTempoTimeline);
}
