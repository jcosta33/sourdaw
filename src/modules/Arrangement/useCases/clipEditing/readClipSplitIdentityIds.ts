import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { isRecord } from '#/utils/structuralEquality';

import { getTrackState } from '../../repositories/track/getTrackState';
import { collectClipSplitIdentityIds } from '../../services/collectClipSplitIdentityIds';

import type { AppAction, ClipAutomationLaneSnapshot, ClipSnapshot } from '#/utils/handlerContract';

function withoutClipKeys(value: unknown, retiredClipIds: ReadonlySet<string>): unknown {
    if (!isRecord(value)) {
        return value;
    }
    return Object.fromEntries(Object.entries(value).filter(([clipId]) => !retiredClipIds.has(clipId)));
}

/** Preserve every other committed owner while completed prefix actions retire one clip's material. */
function committedIdentityMaterialAfterPrefix(root: Record<string, unknown>, retiredClipIds: ReadonlySet<string>) {
    if (retiredClipIds.size === 0) {
        return root;
    }
    const retainedRoot = Object.assign({}, root);
    if (isRecord(root.tracks) && Array.isArray(root.tracks.tracks)) {
        const tracks: unknown[] = root.tracks.tracks;
        retainedRoot.tracks = {
            ...root.tracks,
            tracks: tracks.map((track) => {
                if (!isRecord(track) || !Array.isArray(track.clips)) {
                    return track;
                }
                const clips: unknown[] = track.clips;
                return {
                    ...track,
                    clips: clips.filter(
                        (clip) => !isRecord(clip) || typeof clip.id !== 'string' || !retiredClipIds.has(clip.id)
                    ),
                };
            }),
        };
    }
    if (isRecord(root.midi)) {
        retainedRoot.midi = {
            ...root.midi,
            notesByClipId: withoutClipKeys(root.midi.notesByClipId, retiredClipIds),
            ccByClipId: withoutClipKeys(root.midi.ccByClipId, retiredClipIds),
            pitchBendByClipId: withoutClipKeys(root.midi.pitchBendByClipId, retiredClipIds),
        };
    }
    if (isRecord(root.takeLanes) && Array.isArray(root.takeLanes.lanes)) {
        const lanes: unknown[] = root.takeLanes.lanes;
        retainedRoot.takeLanes = {
            ...root.takeLanes,
            lanes: lanes.flatMap((lane) => {
                if (!isRecord(lane) || !Array.isArray(lane.takes)) {
                    return [lane];
                }
                const existingTakes: unknown[] = lane.takes;
                const removedTakeIds = new Set(
                    existingTakes.flatMap((take) => {
                        if (
                            isRecord(take) &&
                            typeof take.clipId === 'string' &&
                            retiredClipIds.has(take.clipId) &&
                            typeof take.id === 'string'
                        ) {
                            return [take.id];
                        }
                        return [];
                    })
                );
                const takes = existingTakes.filter(
                    (take) => !isRecord(take) || typeof take.id !== 'string' || !removedTakeIds.has(take.id)
                );
                if (takes.length === 0 && existingTakes.length > 0) {
                    return [];
                }
                const nextLane: Record<string, unknown> = { ...lane, takes };
                if (Array.isArray(lane.activeCompRegions)) {
                    const regions: unknown[] = lane.activeCompRegions;
                    nextLane.activeCompRegions = regions.filter(
                        (region) =>
                            !isRecord(region) || typeof region.takeId !== 'string' || !removedTakeIds.has(region.takeId)
                    );
                }
                return [nextLane];
            }),
        };
    }
    if (isRecord(root.gainEnvelopes)) {
        retainedRoot.gainEnvelopes = {
            ...root.gainEnvelopes,
            envelopes: withoutClipKeys(root.gainEnvelopes.envelopes, retiredClipIds),
        };
    }
    if (isRecord(root.warpStates)) {
        retainedRoot.warpStates = {
            ...root.warpStates,
            states: withoutClipKeys(root.warpStates.states, retiredClipIds),
        };
    }
    return retainedRoot;
}

/** Automation shares the live project's identity namespace. Arrangement snapshots
 * have their own namespace, and canonical gain points are local to their clip.
 * Read Automation from the current/prefix owner state so replay can retire its
 * expected right lanes without treating their own committed IDs as peer reuse. */
export function readClipSplitIdentityIds(
    lanes: readonly ClipAutomationLaneSnapshot[],
    clips: readonly ClipSnapshot[] = getTrackState()?.tracks.flatMap((track) => track.clips) ?? [],
    priorActions: readonly AppAction[] = []
): Set<string> {
    const ids = collectClipSplitIdentityIds(lanes);
    const root = getCrdtDoc('root');
    const localPoints = new WeakSet<object>();
    if (root) {
        const retiredClipIds = new Set(
            priorActions.flatMap((action) => {
                if (action.type === 'discardDuplicatedClip' || action.type === 'removeClip') {
                    return [action.payload.clipId];
                }
                if (action.type === 'restoreClipSplitState' && !action.payload.replacement.rightClip) {
                    return [action.payload.rightClipId];
                }
                return [];
            })
        );
        const retainedRoot = committedIdentityMaterialAfterPrefix(root, retiredClipIds);
        const gain = retainedRoot.gainEnvelopes;
        const envelopes = isRecord(gain) && isRecord(gain.envelopes) ? gain.envelopes : {};
        for (const envelope of Object.values(envelopes)) {
            if (!isRecord(envelope) || !Array.isArray(envelope.points)) {
                continue;
            }
            for (const point of envelope.points) {
                if (isRecord(point)) {
                    localPoints.add(point);
                }
            }
        }
        const live = Object.fromEntries(
            Object.entries(retainedRoot).filter(([key]) => key !== 'arrangements' && key !== 'automation')
        );
        ids.push(...collectClipSplitIdentityIds(live, localPoints));
    }
    // Earlier writes in an open transaction are already visible here while
    // its committed root is still the previous document.
    ids.push(...collectClipSplitIdentityIds(clips));
    return new Set(ids);
}
