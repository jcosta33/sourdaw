import { audioEngine } from '#/modules/AudioEngine/useCases';
import {
    readBeatAtSamples,
    readSecondsAtBeat,
    tempoMapStore,
    transportStore,
    DEFAULT_TEMPO_BPM,
} from '#/modules/Transport/stores';

import { isRecordingOnArmedTrack } from './isRecordingOnArmedTrack';
import { type RecordingPlacementDependencies } from './recordingPlacementDependencies';

type RecordedClip = { id: string; startBeat: number; endBeat: number };

/**
 * Where one live instant lands in the clip a take records into. Every field is
 * derived from the same latency-rewound origin, so a note's onset, its length
 * and any controller event of the same take agree on one coordinate (#4668).
 */
export type RecordingPlacement = {
    clipId: string;
    /** Clip-relative beat of the heard instant, never before the clip's media origin. */
    clipBeat: number;
    /** Timeline-absolute beat of the heard instant: the admitted beat rewound by the output latency. */
    latencyAdjustedBeat: number;
    /** Timeline seconds of the heard instant, the anchor expression offsets integrate from. */
    originSeconds: number;
    /** The transport's base tempo, authoritative only while the tempo map is empty. */
    defaultTempo: number;
    flatTimeline: boolean;
};

type ResolveRecordingPlacementInput = {
    trackId: string;
    /** Timeline-absolute beat the instant was admitted at, before latency compensation. */
    admittedBeat: number;
};

/**
 * Distance from a beat to a half-open [startBeat, endBeat) clip: zero inside,
 * otherwise the beats to the nearer edge. The onset reaching this helper is
 * outside every candidate, so one of the two terms is always positive.
 */
function clipDistance(clip: RecordedClip, beat: number): number {
    return Math.max(clip.startBeat - beat, beat - clip.endBeat);
}

/** The clip whose span sits nearest the beat, earlier clip winning a tie. */
function nearestClip(clips: RecordedClip[], beat: number): RecordedClip {
    return clips.reduce((best, clip) => (clipDistance(clip, beat) < clipDistance(best, beat) ? clip : best));
}

function findActiveRecordingClip(
    deps: RecordingPlacementDependencies,
    trackId: string,
    compensatedOnsetBeat: number,
    rawOnsetBeat: number
): string | null {
    const trackState = deps.getTrackStoreState();
    const transport = deps.getTransportStoreValue();
    if (!trackState || !transport) {
        return null;
    }

    const track = trackState.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return null;
    }

    const midiClips = track.clips.filter((clip) => clip.type === 'midi');
    if (midiClips.length === 0) {
        return null;
    }

    if (!(transport.isRecording && transport.overdubEnabled)) {
        return midiClips[midiClips.length - 1]!.id;
    }

    // Half-open [startBeat, endBeat), matching every other clip range
    // test in this module. An inclusive end makes the seam beat of two
    // abutting clips satisfy both, so `find` files the note into
    // whichever clip happens to come first in array order.
    const intersecting = midiClips.find(
        (clip) => compensatedOnsetBeat >= clip.startBeat && compensatedOnsetBeat < clip.endBeat
    );
    if (intersecting) {
        return intersecting.id;
    }

    // The loop rescue keys on the region either coordinate puts the onset
    // in (#4869): a latency-rewound onset can sit before loopStart while
    // the musician's raw onset was inside the region, and the wrap must
    // not cost the note its loop clip.
    const insideLoopRegion = (beat: number): boolean =>
        transport.isLooping && beat >= transport.loopStart && beat <= transport.loopEnd;
    if (insideLoopRegion(compensatedOnsetBeat) || insideLoopRegion(rawOnsetBeat)) {
        const loopClips = midiClips.filter(
            (clip) => clip.startBeat >= transport.loopStart && clip.endBeat <= transport.loopEnd
        );
        if (loopClips.length > 0) {
            return nearestClip(loopClips, compensatedOnsetBeat).id;
        }
    }

    // An onset outside every clip still belongs to the clip it played
    // against: the nearest one in time (#4869). Before-all onsets take
    // the first clip and in-gap onsets the nearer neighbor; the old
    // last-clip fallback filed a seam-rewound onset into the track's
    // last clip, half the arrangement away.
    return nearestClip(midiClips, compensatedOnsetBeat).id;
}

/**
 * Resolve the clip and clip-relative beat a live instant is recorded at, or
 * `null` when the transport is not recording, the track is not armed, or the
 * track holds no MIDI clip to record into.
 *
 * With a tempo map `transport.tempo` is inert (setTempo), so the latency
 * compensation converts through the map's own placement reads — the same
 * conversion audio recording applies to a take (#3650, #4668). A flat timeline
 * integrates as the straight base-tempo line, where the closed form is exact.
 *
 * The instant belongs to the clip holding its admitted onset: a release
 * processed after the playhead crossed a clip seam or a loop wrap must not move
 * it (#4869). Selection and storage share the compensated coordinate: resolving
 * on the raw onset would file the event into the clip past the seam and clamp
 * it to that clip's origin — a heard 3.92 whose raw read is 4.02 (#4668).
 */
export function resolveRecordingPlacement(
    deps: RecordingPlacementDependencies,
    { trackId, admittedBeat }: ResolveRecordingPlacementInput
): RecordingPlacement | null {
    if (!isRecordingOnArmedTrack(deps, trackId)) {
        return null;
    }

    const trackLatencySec = deps.getCompensationDelay(trackId);
    const context = audioEngine.context;
    const totalLatencySec = (context.baseLatency || 0) + (context.outputLatency || 0) + trackLatencySec;

    const tempoChanges = tempoMapStore.value?.changes ?? [];
    const defaultTempo = transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM;
    const flatTimeline = tempoChanges.length === 0;
    const onsetSeconds = readSecondsAtBeat({ beat: admittedBeat });
    // The latency-rewound anchor: the timeline instant the musician heard the
    // event at — the take conversion's `originSeconds` (#3650).
    const originSeconds = onsetSeconds - totalLatencySec;
    let latencyAdjustedBeat = admittedBeat - (totalLatencySec * defaultTempo) / 60;
    if (!flatTimeline) {
        latencyAdjustedBeat = readBeatAtSamples({ samples: originSeconds, sampleRate: 1 });
    }

    const clipId = findActiveRecordingClip(deps, trackId, latencyAdjustedBeat, admittedBeat);
    if (!clipId) {
        return null;
    }

    // The admitted beat is timeline-absolute; the store is clip-relative, so
    // subtract the recording clip's media origin or events land clip.startBeat
    // late (M-143).
    const recordingClip = deps
        .getTrackStoreState()
        ?.tracks.find((candidate) => candidate.id === trackId)
        ?.clips.find((candidate) => candidate.id === clipId);
    const clipMediaOrigin = recordingClip ? recordingClip.startBeat - (recordingClip.midiOffsetBeats ?? 0) : 0;

    return {
        clipId,
        clipBeat: Math.max(0, latencyAdjustedBeat - clipMediaOrigin),
        latencyAdjustedBeat,
        originSeconds,
        defaultTempo,
        flatTimeline,
    };
}
