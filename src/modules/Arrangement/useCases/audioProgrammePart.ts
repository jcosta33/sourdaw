import { type TempoTimeline } from '../models/TempoTimeline';
import { type AudioWaveformProgrammePart } from '../models/TimelineRenderModel';

import { type resolveCompingProgramme } from './comping/resolveCompingProgramme';

export function audioProgrammePart(
    clip: ReturnType<typeof resolveCompingProgramme>[number],
    timeline: TempoTimeline
): AudioWaveformProgrammePart {
    return {
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        audioOffsetBeats: clip.audioOffsetBeats,
        audioOffsetSeconds: clip.audioOffsetSeconds,
        audioLoopStartSeconds: clip.audioLoopStartSeconds,
        audioLoopPassEntrySeconds: clip.audioLoopPassEntrySeconds,
        audioLoopPassOriginBeat: clip.audioLoopPassOriginBeat,
        loopOriginBeat: clip.loopOriginBeat,
        clipStartTempo: timeline.tempoAtBeat(clip.startBeat),
        stretchRatio: clip.stretchRatio,
        stretchMode: clip.stretchMode,
        loopEnabled: clip.loopEnabled,
        loopLength: clip.loopLength,
    };
}
