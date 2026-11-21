import { trackStore } from '#/modules/Arrangement/stores';

function findClip(clipId: string) {
    for (const track of trackStore.value?.tracks ?? []) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return { track, clip };
        }
    }
    return null;
}

/**
 * Why the live arrangement cannot take a groove on this clip, for a clip the writable MIDI clip
 * guard has already refused; a clip only an earlier batch action creates has no live row to name.
 */
export function describeUnwritableGrooveClip(clipId: string): string {
    const found = findClip(clipId);
    if (!found) {
        return `Clip "${clipId}" does not exist`;
    }
    if (found.clip.type !== 'midi' || found.track.kind !== 'midi') {
        return `Clip "${clipId}" is not a MIDI clip`;
    }
    if (found.clip.locked === true) {
        return `Clip "${clipId}" is locked`;
    }
    if (found.track.frozen === true) {
        return `Clip "${clipId}" is on a frozen track`;
    }
    return `Clip "${clipId}" cannot take a groove`;
}
