import { logger } from '#/infra/logger/appLogger';
import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { prepareMidiClipFanOutState } from '#/modules/MIDI/useCases';
import { type ClipGlueActionSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip, type Track } from '../../models/Track';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { readClipScopedAutomationLanes } from '../clip/readClipScopedAutomationLanes';
import { restoreClipGlueState } from '../clipEditing/restoreClipGlueState';
import { resolveClipsWithComping, type ResolvedClip } from '../resolveComping';

import { insertTakeLane } from './insertTakeLane';
import { removeTakeLane } from './removeTakeLane';
import { pushTargetedTakeLaneUndoEntry } from './takeLaneUndo';

const FLATTEN_LABEL = 'Flatten comp';

type FlattenPlan = {
    previous: ClipGlueActionSnapshot;
    next: ClipGlueActionSnapshot;
};

/**
 * One resolved fragment as a clip the store can hold: a fresh identity, every
 * placement and media field copied through, and the resolver's own vocabulary
 * (`regionStartBeat`, `regionEndBeat`, `sourceStartBeat`) dropped — those are
 * not `Clip` fields and nothing downstream of the store reads them.
 */
function toStoredClip(resolved: ResolvedClip): Clip {
    const {
        regionStartBeat: _regionStart,
        regionEndBeat: _regionEnd,
        sourceStartBeat: _sourceStart,
        ...clipFields
    } = resolved;
    return { ...clipFields, id: getNextClipId() };
}

function hasClipSatelliteData(clipIds: readonly string[]): boolean {
    return clipIds.some((clipId) => {
        const entry = readClipSatelliteEntry(clipId);
        return entry.gainEnvelope !== null || entry.warpState !== null;
    });
}

/**
 * The clip transaction that turns the take programme into ordinary clips, or
 * `null` when the copy would not sound like what the comp plays.
 *
 * A recorded take carries no gain envelope, no warp state and no clip-scoped
 * automation, so refusing those cases costs nothing a musician can reach
 * through comping — and it keeps Flatten exact rather than silently retiring
 * satellite state that was audible a moment earlier.
 */
function planFlatten(track: Track): FlattenPlan | null {
    const programme = resolveClipsWithComping(track.id, track.clips);
    const sourceClipIds = track.clips.map((clip) => clip.id);
    if (programme.length === 0) {
        logger.warn(
            'flattenComp: the take lane resolves to no clips at all — refusing to flatten this track into silence'
        );
        return null;
    }
    if (hasClipSatelliteData(sourceClipIds)) {
        logger.warn('flattenComp: a clip on this track carries a gain envelope or warp state — refusing to flatten');
        return null;
    }
    if (readClipScopedAutomationLanes(sourceClipIds).length > 0) {
        logger.warn('flattenComp: a clip on this track carries clip-scoped automation — refusing to flatten');
        return null;
    }

    const fragments = programme.map(toStoredClip);
    const fanOut = prepareMidiClipFanOutState({
        sourceClipIds,
        // Every fragment, not just the MIDI ones: the id lists of both
        // snapshots are what names the whole affected clip set to
        // `restoreClipGlueState`, and an unnamed clip would neither be retired
        // nor guarded.
        copies: programme.map((resolved, index) => ({
            sourceClipId: resolved.id,
            targetClipId: fragments[index]!.id,
        })),
    });
    if (!fanOut) {
        logger.warn('flattenComp: this track’s MIDI data cannot be copied onto the comped fragments');
        return null;
    }

    // `restoreClipGlueState`'s freshness guard asserts "nothing lives here" for
    // the full affected set, so both sides name every source and every fragment
    // explicitly rather than only the ids that happen to carry satellites.
    const clipSatellites = [...sourceClipIds, ...fragments.map((fragment) => fragment.id)].map((clipId) => ({
        clipId,
        gainEnvelope: null,
        warpState: null,
    }));
    return {
        previous: {
            trackId: track.id,
            clips: structuredClone(track.clips),
            clipOrder: sourceClipIds,
            midi: fanOut.previous,
            clipSatellites,
            clipAutomationLanes: [],
        },
        next: {
            trackId: track.id,
            clips: fragments,
            clipOrder: fragments.map((fragment) => fragment.id),
            midi: fanOut.next,
            clipSatellites,
            clipAutomationLanes: [],
        },
    };
}

/**
 * Commit the comp: replace the track's clips with exactly the clip set the
 * comping resolver plays, and retire the take lane, under one undo entry.
 *
 * Comp state lives entirely in the take lane — `activeCompRegions` select which
 * take sounds where — so removing the lane alone made the flattened track play
 * every take at once (#3795). Materialising the resolver's own output is what
 * makes the three projections (live Web Audio, offline render, native) sound
 * the same selection before and after Flatten by construction.
 *
 * The clip half reuses glue's transaction: one guarded, reversible replacement
 * of a clip set by another, carrying the MIDI rows with it. The lane's presence
 * is sequenced around it because a take referencing an affected clip makes that
 * transaction refuse.
 */
export function flattenComp(trackId: string): boolean {
    const laneState = takeLaneStore.value;
    const lane = laneState?.lanes.find((candidate) => candidate.trackId === trackId);
    if (!laneState || !lane) {
        return false;
    }
    const track = getTrackState()?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return false;
    }
    const laneIndex = laneState.lanes.indexOf(lane);

    if (lane.activeCompRegions.length === 0 || track.clips.length === 0) {
        removeTakeLane(lane.id);
        // The entry captures only the removed lane (#4081): replaying a
        // whole-store snapshot on undo erased every later edit to any other lane.
        pushTargetedTakeLaneUndoEntry({ kind: 'lane-removed', label: FLATTEN_LABEL, lane, laneIndex });
        return true;
    }

    const plan = planFlatten(track);
    if (!plan) {
        return false;
    }

    removeTakeLane(lane.id);
    if (!restoreClipGlueState({ expected: plan.previous, replacement: plan.next })) {
        insertTakeLane(lane, laneIndex);
        logger.warn('flattenComp: the clip replacement was refused — the take lane is unchanged');
        return false;
    }

    // Each direction restores the clips while the lane is absent, because the
    // lane's takes reference the very clips being replaced. Either direction can
    // still be refused — a fragment edited after the flatten, an original clip
    // edited after the undo — and the lane must follow the clips: a lane whose
    // takes name clips the track does not hold is a comp no resolver can play.
    pushUndoEntry(
        FLATTEN_LABEL,
        () => {
            if (!restoreClipGlueState({ expected: plan.next, replacement: plan.previous })) {
                logger.warn(
                    'flattenComp: undoing the flatten was refused — the clips stand and the lane stays retired'
                );
                notifyUser('Failed to undo flatten comp - the clips no longer match the flattened result', 'error');
                return;
            }
            insertTakeLane(lane, laneIndex);
        },
        () => {
            removeTakeLane(lane.id);
            if (restoreClipGlueState({ expected: plan.previous, replacement: plan.next })) {
                return undefined;
            }
            insertTakeLane(lane, laneIndex);
            logger.warn('flattenComp: redoing the flatten was refused — the clips and the lane stand');
            notifyUser('Failed to redo flatten comp - the clips no longer match the flattened state', 'error');
            // This forward path is gone for good: the clips it would retire are
            // not the clips on the track. Reporting not-applied drops the entry
            // instead of pinning it at the head of `future`, where it would
            // wedge every redoable entry behind it (`splitClipWithUndo`
            // precedent).
            return REDO_NOT_APPLIED;
        }
    );
    return true;
}
