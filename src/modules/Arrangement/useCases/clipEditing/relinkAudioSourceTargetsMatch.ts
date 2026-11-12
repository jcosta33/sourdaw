import { type RelinkTarget, RELINK_AUDIO_SOURCE_KEYS } from '../../models/RelinkAudioSourceTarget';
import { type Clip, type Track } from '../../models/Track';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

function matches(track: Track, clip: Clip, target: RelinkTarget): boolean {
    if (
        track.kind !== target.trackKind ||
        track.activeAlternativeId !== target.activeAlternativeId ||
        track.frozen ||
        track.freezeState.status !== 'unfrozen' ||
        clip.locked ||
        clip.trackId !== target.trackId ||
        clip.type !== 'audio'
    ) {
        return false;
    }
    return RELINK_AUDIO_SOURCE_KEYS.every(
        (key) =>
            clip[key] === target.before[key] && (key === 'audioBufferId' || target.before[key] === target.after[key])
    );
}

export function relinkAudioSourceTargetsMatch(targets: readonly RelinkTarget[]): boolean {
    if (targets.length === 0) {
        return false;
    }
    const keys = new Set<string>();
    for (const target of targets) {
        if (
            target.before.audioBufferId === target.after.audioBufferId ||
            target.before.audioBufferId === '' ||
            target.after.audioBufferId === ''
        ) {
            return false;
        }
        const key = JSON.stringify([target.trackId, target.alternativeId, target.clipId]);
        if (keys.has(key)) {
            return false;
        }
        keys.add(key);
        const owners = trackStore.value?.tracks.filter((track) => track.id === target.trackId) ?? [];
        if (owners.length !== 1) {
            return false;
        }
        const track = owners[0]!;
        const eligible = resolveEligibleClipWriteTarget({ trackId: target.trackId });
        if (eligible.status !== 'eligible' || eligible.trackId !== target.trackId) {
            return false;
        }
        let clips = track.clips;
        if (target.alternativeId !== null) {
            if (target.alternativeId === track.activeAlternativeId) {
                return false;
            }
            const alternatives = track.alternatives.filter((item) => item.id === target.alternativeId);
            if (alternatives.length !== 1) {
                return false;
            }
            clips = alternatives[0]!.clips;
        } else if (resolveEligibleClipWriteTarget({ clipId: target.clipId }).status !== 'eligible') {
            return false;
        }
        const found = clips.filter((clip) => clip.id === target.clipId);
        if (found.length !== 1 || !matches(track, found[0]!, target)) {
            return false;
        }
    }
    return true;
}
