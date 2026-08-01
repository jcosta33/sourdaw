import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { transportStore } from '#/modules/Transport/stores';
import { resolveFrozenBufferTail } from '#/utils/frozenBufferTail';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip } from '../../models/Track';
import { updateTrack } from '../../repositories/track/updateTrack';
import { isSilentAudioBuffer } from '../../services/isSilentAudioBuffer';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

export function flattenTrack(trackId: string): boolean {
    const target = resolveEligibleClipWriteTarget({ trackId });
    if (target.status !== 'eligible') {
        return false;
    }

    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    if (!track || track.freezeState.status !== 'frozen') {
        return false;
    }

    const { frozenBufferId } = track.freezeState;
    if (!frozenBufferId) {
        return false;
    }

    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const context of track.clips) {
        if (context.startBeat < startBeat) {
            startBeat = context.startBeat;
        }
        if (context.endBeat > endBeat) {
            endBeat = context.endBeat;
        }
    }
    if (startBeat === Infinity) {
        startBeat = 0;
    }
    if (endBeat === -Infinity) {
        endBeat = 1;
    }

    // Flatten judges by a different rule from freeze and bounce, on purpose.
    //
    // Those two observe what their own render scheduled. Flatten has no render
    // to observe: it may be handed a buffer baked in another session, by
    // another build, or by another machine through a loaded project — the case
    // the freeze-side guard structurally cannot cover. Reconstructing "should
    // this have sounded?" from the track alone would be exactly the prediction
    // that guard was rebuilt to avoid.
    //
    // So it asks a question it can answer without any model: would this write
    // trade the track's clips and devices for a clip containing no audio at
    // all? That outcome has no legitimate value — a user who wants an empty
    // track deletes the clips — so refusing costs nothing even in the cases
    // where the silence was deliberate. A buffer absent from the cache cannot
    // be read, and is left to the existing behaviour.
    const frozenBuffer = audioBufferCache.get(frozenBufferId);
    if (frozenBuffer && isSilentAudioBuffer(frozenBuffer)) {
        notifyUser(
            `Track "${track.name}" is frozen to a buffer that contains no audio. Flatten stopped rather than ` +
                `replacing the track's clips and devices with a silent clip. Unfreeze the track to keep working ` +
                `on it, or delete its clips if it is meant to be empty.`,
            'error'
        );
        return false;
    }

    const bakedTail = resolveFrozenBufferTail(track.freezeState.renderSettings);
    const frozenTailSeconds = bakedTail.known ? bakedTail.seconds : bakedTail.atLeastSeconds;

    const newClip: Clip = {
        id: `flattened-${crypto.randomUUID()}`,
        trackId: target.trackId,
        name: `${track.name} (Flattened)`,
        startBeat,
        // Flatten bakes this clip permanently into the timeline, so an unknown
        // baked tail must not resolve to zero: the buffer's decay past the clip
        // content would be discarded from the project itself, not from a single
        // export, and no later fix can recover it.
        endBeat: endBeat + frozenTailSeconds * ((transportStore.value?.tempo ?? 120) / 60),
        type: 'audio',
        audioBufferId: frozenBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: track.color,
        locked: false,
        muted: false,
    };

    const altId = `alt-flatten-${crypto.randomUUID().slice(0, 8)}`;
    updateTrack(target.trackId, (time) => ({
        ...time,
        kind: 'audio',
        clips: [newClip],
        devices: [],
        frozen: false,
        frozenBufferId: undefined,
        freezeState: { status: 'unfrozen' },
        activeAlternativeId: altId,
        alternatives: [{ id: altId, name: 'Flattened', clips: [newClip] }],
    }));
    return true;
}
