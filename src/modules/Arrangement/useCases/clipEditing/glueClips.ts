import { logger } from '#/infra/logger/appLogger';
import { glueMidiClipData } from '#/modules/MIDI/useCases';

import { type Clip } from '../../models/Track';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

export function glueClips(clipIds: string[]): boolean {
    if (!Array.isArray(clipIds) || clipIds.length < 2 || new Set(clipIds).size !== clipIds.length) {
        return false;
    }

    const ownerTrackIds = new Set<string>();
    for (const clipId of clipIds) {
        const resolution = resolveEligibleClipWriteTarget({ clipId });
        if (resolution.status !== 'eligible') {
            return false;
        }
        ownerTrackIds.add(resolution.trackId);
    }

    if (ownerTrackIds.size !== 1) {
        logger.warn('glueClips: clips span multiple tracks — gluing is only supported within a single track');
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const [ownerTrackId] = ownerTrackIds;
    const firstTrack = state.tracks.find((track) => track.id === ownerTrackId);
    if (!firstTrack) {
        return false;
    }
    const clips = firstTrack.clips.filter((context) => clipIds.includes(context.id));
    if (clips.length !== clipIds.length) {
        return false;
    }
    // Audio glue would produce a clip with no audioBufferId — silent — while
    // deleting the sources (ledger M-027). Refuse until a real audio-concat
    // glue exists; the sources stay untouched.
    if (clips.some((clip) => clip.type !== 'midi')) {
        logger.warn('glueClips: only MIDI clips can be glued — refusing to create a silent audio clip');
        return false;
    }
    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const context of clips) {
        if (context.startBeat < startBeat) {
            startBeat = context.startBeat;
        }
        if (context.endBeat > endBeat) {
            endBeat = context.endBeat;
        }
    }
    const gluedId = getNextClipId();
    const glued: Clip = {
        id: gluedId,
        trackId: firstTrack.id,
        name: `${clips[0]!.name} (glued)`,
        startBeat,
        endBeat,
        type: clips[0]!.type,
        fadeInBeats: clips[0]!.fadeInBeats,
        fadeOutBeats: clips[clips.length - 1]!.fadeOutBeats,
        gain: 1.0,
        color: clips[0]!.color,
        locked: false,
        muted: false,
    };
    updateTrack(firstTrack.id, (time) => ({
        ...time,
        clips: [...time.clips.filter((context) => !clipIds.includes(context.id)), glued],
    }));
    glueMidiClipData({ sourceClipIds: clipIds, targetClipId: gluedId });

    return true;
}
