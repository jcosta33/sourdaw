import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { transportStore } from '#/modules/Transport/stores';
import { resolveFrozenBufferTail } from '#/utils/frozenBufferTail';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip } from '../../models/Track';
import { updateTrack } from '../../repositories/track/updateTrack';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

import { detectSilentBake } from './detectSilentBake';

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

    // The last stop before the destructive write below, and the only one that
    // can catch a buffer this session did not bake — a project loaded with a
    // frozen track, or one frozen by a build that predates the freeze-side
    // guard. A buffer missing from the cache cannot be judged and is left to
    // the existing behaviour; only a buffer proved silent is refused.
    const frozenBuffer = audioBufferCache.get(frozenBufferId);
    if (frozenBuffer) {
        const silentBake = detectSilentBake({
            track,
            buffer: frozenBuffer,
            startBeat,
            endBeat,
            // The buffer was printed with the target fader kept live, so the
            // track's own gain is not baked into it.
            bakedFaderGain: 1,
            operation: 'Flatten',
        });
        if (silentBake.silentBake) {
            notifyUser(silentBake.message, 'error');
            return false;
        }
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
