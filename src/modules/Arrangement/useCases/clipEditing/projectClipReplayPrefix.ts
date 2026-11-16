import { getAutomationLanes } from '#/modules/Automation/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { type TempoSourceClock } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';

import { type ClipAutomationLaneSnapshot } from '../../events/arrangementClipStateSnapshots';
import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Track } from '../../stores/trackStore';
import { getTrackStoreState } from '../getTrackStoreState';

import { capturedTimeline } from './capturedTimeline';
import { projectClipAction } from './projectClipAction';
import { type ShiftedOwnerState } from './ShiftedOwnerState';
import { tracksWithProjectedClips } from './tracksWithProjectedClips';

/** Exactly the geometry and automation clip removal and `undoRippleDelete` write, in group order.
 * Restored lanes matter even when that earlier removal did not ripple: a later
 * inverse may shift the clip the earlier inverse just brought back. */
export function projectClipReplayPrefix(
    priorActions: readonly AppAction[] = [],
    initial?: {
        readonly tracks: readonly Track[];
        readonly takeLanes: readonly TakeLane[];
        readonly automationLanes: readonly ClipAutomationLaneSnapshot[];
        readonly clock: TempoSourceClock;
    }
): ShiftedOwnerState | null {
    const tracks = initial?.tracks ?? getTrackStoreState()?.tracks ?? [];
    const trackIds = tracks.map((track) => track.id);
    const clock = structuredClone(
        initial?.clock ?? {
            tempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM,
            changes: tempoMapStore.value?.changes ?? [],
        }
    );
    let state: ShiftedOwnerState = {
        clips: tracks.flatMap((track) => track.clips.map((clip) => ({ owningTrackId: track.id, clip }))),
        lanes: initial?.automationLanes ?? getAutomationLanes(),
        tracks,
        takeLanes: structuredClone(initial?.takeLanes ?? takeLaneStore.value?.lanes ?? []),
        clock,
        timeline: capturedTimeline(clock),
    };
    for (const action of priorActions) {
        const next = projectClipAction(state, action, trackIds);
        if (!next) {
            return null;
        }
        state = next;
    }
    return { ...state, tracks: tracksWithProjectedClips(state) };
}
