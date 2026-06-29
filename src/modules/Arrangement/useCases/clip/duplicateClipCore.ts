import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { duplicateClipNotes } from '#/modules/MIDI/stores';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { getWarpState, setWarpState } from '../../stores/warpStates';

import { addClip } from './addClip';

type DuplicateClipCoreInput = {
    clipId: string;
    targetClipId?: string;
    computeStartBeat: (clip: Clip) => number;
};

export function duplicateClipCore(input: DuplicateClipCoreInput): void;
export function duplicateClipCore(clipId: string, computeStartBeat: (clip: Clip) => number): void;
export function duplicateClipCore(
    input: DuplicateClipCoreInput | string,
    legacyComputeStartBeat?: (clip: Clip) => number
): void {
    const clipId = typeof input === 'string' ? input : input.clipId;
    const targetClipId = typeof input === 'string' ? undefined : input.targetClipId;
    const computeStartBeat = typeof input === 'string' ? legacyComputeStartBeat : input.computeStartBeat;
    if (!computeStartBeat) {
        return;
    }

    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((context) => context.id === clipId);
        if (clip) {
            const duration = clip.endBeat - clip.startBeat;
            const startBeat = computeStartBeat(clip);
            // Carry the full editable property set forward so the duplicate is a
            // faithful copy. Previously only id/track/span/name/type/buffer were
            // passed, silently dropping fades, gain, mute, lock, color, offsets,
            // loop, and stretch settings.
            const newClip = addClip({
                id: targetClipId,
                trackId: track.id,
                startBeat,
                endBeat: startBeat + duration,
                name: `${clip.name} (copy)`,
                type: clip.type,
                audioBufferId: clip.audioBufferId,
                assetHash: clip.assetHash,
                audioOffsetBeats: clip.audioOffsetBeats,
                midiOffsetBeats: clip.midiOffsetBeats,
                fadeInBeats: clip.fadeInBeats,
                fadeOutBeats: clip.fadeOutBeats,
                gain: clip.gain,
                color: clip.color,
                locked: clip.locked,
                muted: clip.muted,
                stretchMode: clip.stretchMode,
                stretchRatio: clip.stretchRatio,
                loopEnabled: clip.loopEnabled,
                loopLength: clip.loopLength,
                followAction: clip.followAction,
            });

            if (newClip) {
                duplicateClipAutomation(clipId, newClip.id);

                // Warp markers live in a clip-keyed map, not on the clip record,
                // so they must be copied explicitly.
                const sourceWarp = getWarpState(clipId);
                setWarpState(newClip.id, {
                    ...sourceWarp,
                    markers: sourceWarp.markers.map((marker) => ({ ...marker })),
                });

                if (clip.type === 'midi') {
                    duplicateClipNotes(clipId, newClip.id);
                }
            }
            return;
        }
    }
}
