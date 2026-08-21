import { getMidiStoreState, removeMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { readClipScopedAutomationLanes } from '../../useCases/clip/readClipScopedAutomationLanes';
import { removeClip } from '../../useCases/clip/removeClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { planRippleDelete } from '../../useCases/rippleDelete/planRippleDelete';
import { rippleDeleteClips } from '../../useCases/rippleDelete/rippleDeleteClips';

// Minimal structural clip shape used to widen a concrete Clip into the structural
// `ClipSnapshot` carried by the `restoreClip` inverse action payload.
type MinimalClipShape = { id: string; trackId: string; name: string; startBeat: number; endBeat: number };

export const handleRemoveClip = createHandler<'removeClip'>({
    execute: (alpha) => {
        const state = getTrackStoreState();
        let trackId: string | null = null;
        if (state) {
            for (const track of state.tracks) {
                if (track.clips.some((context) => context.id === alpha.payload.clipId)) {
                    trackId = track.id;
                    break;
                }
            }
        }
        if (!trackId) {
            removeClip(alpha.payload.clipId);
            return;
        }
        const rippleResult = rippleDeleteClips({ trackId, clipIds: [alpha.payload.clipId] });
        if (rippleResult === null) {
            removeClip(alpha.payload.clipId);
            return;
        }
        removeMidiClipData(rippleResult.removedClips.map((clip) => clip.id));
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        let clipSnapshot: MinimalClipShape | null = null;
        let trackId: string | null = null;
        if (state) {
            for (const track of state.tracks) {
                const clip = track.clips.find((context) => context.id === alpha.payload.clipId);
                if (clip) {
                    clipSnapshot = structuredClone(clip);
                    trackId = track.id;
                    break;
                }
            }
        }
        if (!clipSnapshot || !trackId) {
            return { label: 'Remove clip' };
        }

        const plan = planRippleDelete({ trackId, clipIds: [alpha.payload.clipId] });
        const ripplePlan = plan
            ? {
                  removedClips: structuredClone(plan.removedClips) as readonly MinimalClipShape[],
                  shiftedClips: structuredClone(plan.shiftedClips),
                  clipSatellites: plan.removedClips
                      .map((clip) => readClipSatelliteEntry(clip.id))
                      .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null),
                  clipAutomationLanes: readClipScopedAutomationLanes(plan.removedClips.map((clip) => clip.id)),
              }
            : null;

        const midiState = getMidiStoreState();
        const notes = midiState?.notesByClipId[alpha.payload.clipId];
        const cc = midiState?.ccByClipId[alpha.payload.clipId];
        const pb = midiState?.pitchBendByClipId[alpha.payload.clipId];

        return {
            label: `Remove clip "${clipSnapshot.name}"`,
            inverseAction: {
                type: 'restoreClip',
                payload: {
                    clipId: alpha.payload.clipId,
                    trackId,
                    clipSnapshot,
                    ripplePlan,
                    midiNotesSnapshot: notes ? structuredClone(notes) : null,
                    midiCcSnapshot: cc ? structuredClone(cc) : null,
                    midiPitchBendSnapshot: pb ? structuredClone(pb) : null,
                },
            },
        };
    },
    undoable: true,
});
