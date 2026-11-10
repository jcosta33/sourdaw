import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { serializeClipSatelliteEntries } from '../../stores/clipSatelliteState';
import { serializeClipScopedAutomationLanes } from '../../useCases/clip/serializeClipScopedAutomationLanes';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type CreatedClipState = Required<GeneratedMidiStateGuard>;

function findClipById(clipId: string) {
    const trackState = getTrackStoreState();
    if (!trackState) {
        return undefined;
    }
    for (const track of trackState.tracks) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

function readCreatedClipState(clipId: string): CreatedClipState | null {
    const clip = findClipById(clipId);
    if (!clip) {
        return null;
    }
    return {
        entityJson: JSON.stringify(clip),
        midiByClipIdJson: serializeMidiStateForClips([clipId]),
        clipSatellitesJson: serializeClipSatelliteEntries([clipId]),
        clipAutomationLanesJson: serializeClipScopedAutomationLanes([clipId]),
    };
}

/**
 * Pins the state a just-created clip copy carries onto the guard of its
 * `discardDuplicatedClip` inverse, so undo removes the copy only while nothing
 * has changed it since. The kernel calls `describe` before `execute`, so the
 * inverse already holds this guard object and the copy's state is written into
 * it in place. A duplicate clones the source's gain envelope, warp state and
 * clip-scoped automation lanes, so the guard expects exactly those; requiring
 * their absence would make the copy's own undo conflict on what the copy itself
 * made. A copy that is on no track leaves the guard untouched.
 */
export function stampCreatedClipStateGuard(guard: GeneratedMidiStateGuard, clipId: string): void {
    const state = readCreatedClipState(clipId);
    if (!state) {
        return;
    }
    guard.entityJson = state.entityJson;
    guard.midiByClipIdJson = state.midiByClipIdJson;
    guard.clipSatellitesJson = state.clipSatellitesJson;
    guard.clipAutomationLanesJson = state.clipAutomationLanesJson;
}
