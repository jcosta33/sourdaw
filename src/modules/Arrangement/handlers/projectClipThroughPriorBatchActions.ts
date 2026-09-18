import {
    type AppAction,
    type ClipSatelliteEntrySnapshot,
    type HandlerValidationContext,
    type RestoreTrackPayloadSnapshot,
    type TrackSnapshot,
} from '#/utils/handlerContract';

import { type Clip } from '../stores/trackStore';
import {
    readClipScopedAutomationLanes,
    type ClipScopedAutomationLane,
} from '../useCases/clip/readClipScopedAutomationLanes';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

/**
 * One clip as the state a batch's prior members leave behind: the same view of
 * the document the batch's sequential execution gives the member being
 * validated. This is the clip-level counterpart of
 * `projectTrackThroughPriorBatchActions`, built for grouped-undo replay
 * preflights (#3814) — a group's inverse batch validates each member against
 * live state before anything runs, while execution gives every member the
 * writes of its predecessors, so a member whose predecessors restore its
 * preconditions must be validated against that projection instead.
 */
export type ProjectedClipState = {
    /** The clip with the projected state's owner track, or `null` when the
     *  projected state no longer holds the clip. */
    readonly locatedClip: { readonly owningTrackId: string; readonly clip: Clip } | null;
    /**
     * Clip-scoped automation lanes the projected state keys to the clip: the
     * live lanes plus what a prior `restoreTrack` re-adds, resolved the way
     * `restoreAutomationLanes` resolves an id collision (the live lane wins).
     */
    readonly clipScopedLanes: readonly ClipScopedAutomationLane[];
    /**
     * The satellite record a prior `restoreTrack` sibling re-establishes for
     * the clip. `null` means the sibling writes none for the clip, so the live
     * stores keep whatever they hold — `writeClipSatelliteEntry` only runs for
     * captured entries.
     */
    readonly restoredSatelliteEntry: ClipSatelliteEntrySnapshot | null;
    /** Whether any prior sibling touched the clip, its lanes or its satellites.
     *  `false` means the other fields are the plain live read. */
    readonly touchedByPriorSibling: boolean;
};

type LocatableClip = NonNullable<ProjectedClipState['locatedClip']>;

/**
 * The removal snapshots carry whole runtime objects under deliberately narrow
 * contract names — `trackSnapshot` declares only `id`,
 * `automationLaneSnapshots` only `id`/`trackId` — because the generated command
 * argument schemas close every object. The capture sites
 * (`captureTrackRemovalSnapshot`, `handleRemoveClip`'s `describe`) write full
 * `Track`/`AutomationLane`/`Clip` clones, and the restore handlers already
 * bridge that same gap with `as never` when they write the clones back. The
 * readers below narrow the runtime shape through `unknown` instead of assuming
 * it, so a payload that is not the shape its capture site wrote simply does
 * not project.
 */

function findLiveClip(clipId: string): LocatableClip | null {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    return track && clip ? { owningTrackId: track.id, clip } : null;
}

function readSnapshotClip(trackSnapshot: TrackSnapshot, clipId: string): Clip | null {
    const runtimeSnapshot: unknown = trackSnapshot;
    const clips: unknown = (runtimeSnapshot as { clips?: unknown }).clips;
    if (!Array.isArray(clips)) {
        return null;
    }
    for (const candidate of clips) {
        const runtimeClip: unknown = candidate;
        if ((runtimeClip as { id?: unknown }).id === clipId) {
            return runtimeClip as Clip;
        }
    }
    return null;
}

function readSnapshotClipLanes(
    snapshots: RestoreTrackPayloadSnapshot['automationLaneSnapshots'],
    clipId: string
): ClipScopedAutomationLane[] {
    const lanes: ClipScopedAutomationLane[] = [];
    for (const snapshot of snapshots) {
        const runtimeLane: unknown = snapshot;
        if ((runtimeLane as { clipId?: unknown }).clipId !== clipId) {
            continue;
        }
        lanes.push(runtimeLane as ClipScopedAutomationLane);
    }
    return lanes;
}

function lanesAfterLaneRestore(
    live: readonly ClipScopedAutomationLane[],
    restored: readonly ClipScopedAutomationLane[]
): ClipScopedAutomationLane[] {
    const liveLaneIds = new Set(live.map((lane) => lane.id));
    return [...live, ...restored.filter((lane) => !liveLaneIds.has(lane.id))];
}

function applyRestoreTrackSibling(
    state: ProjectedClipState,
    payload: RestoreTrackPayloadSnapshot,
    clipId: string
): ProjectedClipState {
    const restoredClip = readSnapshotClip(payload.trackSnapshot, clipId);
    if (!restoredClip) {
        return state;
    }
    return {
        locatedClip: { owningTrackId: payload.trackId, clip: restoredClip },
        clipScopedLanes: lanesAfterLaneRestore(
            state.clipScopedLanes,
            readSnapshotClipLanes(payload.automationLaneSnapshots, clipId)
        ),
        restoredSatelliteEntry: payload.clipSatellites.find((entry) => entry.clipId === clipId) ?? null,
        touchedByPriorSibling: true,
    };
}

function applyRestoreClipSibling(
    state: ProjectedClipState,
    payload: { trackId: string; clipSnapshot: unknown }
): ProjectedClipState {
    const runtimeClip: unknown = payload.clipSnapshot;
    return {
        locatedClip: { owningTrackId: payload.trackId, clip: runtimeClip as Clip },
        clipScopedLanes: state.clipScopedLanes,
        restoredSatelliteEntry: state.restoredSatelliteEntry,
        touchedByPriorSibling: true,
    };
}

function applyClipRemovalSibling(): ProjectedClipState {
    return {
        locatedClip: null,
        // `removeClip` and `discardDuplicatedClip` both purge through
        // `removeClipSatelliteData`, which takes the retired id's clip-scoped
        // lanes and satellite record with the clip.
        clipScopedLanes: [],
        restoredSatelliteEntry: null,
        touchedByPriorSibling: true,
    };
}

function applyPriorSiblingToClip(state: ProjectedClipState, action: AppAction, clipId: string): ProjectedClipState {
    if (action.type === 'restoreTrack') {
        return applyRestoreTrackSibling(state, action.payload, clipId);
    }
    if (action.type === 'restoreClip' && action.payload.clipId === clipId) {
        return applyRestoreClipSibling(state, action.payload);
    }
    if ((action.type === 'removeClip' || action.type === 'discardDuplicatedClip') && action.payload.clipId === clipId) {
        return applyClipRemovalSibling();
    }
    return state;
}

/**
 * Projects the clip through every prior batch sibling, in order, so a
 * batch-aware `validate` sees the state its predecessors' inverses produce.
 * Actions beyond inverse restores (a `moveClip` never appears in an inverse
 * batch) leave the projection unchanged.
 */
export function projectClipThroughPriorBatchActions(
    clipId: string,
    context: HandlerValidationContext
): ProjectedClipState {
    let state: ProjectedClipState = {
        locatedClip: findLiveClip(clipId),
        clipScopedLanes: readClipScopedAutomationLanes([clipId]),
        restoredSatelliteEntry: null,
        touchedByPriorSibling: false,
    };
    for (const action of context.actions.slice(0, context.actionIndex)) {
        state = applyPriorSiblingToClip(state, action, clipId);
    }
    return state;
}
