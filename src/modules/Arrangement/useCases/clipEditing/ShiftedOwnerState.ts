import { type TempoSourceClock } from '#/modules/Transport/stores';

import { type ClipAutomationLaneSnapshot } from '../../events/arrangementClipStateSnapshots';

import { type ClipSnapshot } from '../../events/arrangementClipSnapshots';
import { type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip, type Track } from '../../stores/trackStore';

export type LocatedClip = { owningTrackId: string; clip: ClipSnapshot & Pick<Clip, 'loopOriginBeat'> };
export type ShiftedOwnerState = {
    clips: readonly LocatedClip[];
    lanes: readonly ClipAutomationLaneSnapshot[];
    tracks: readonly Track[] | null;
    takeLanes: readonly TakeLane[];
    clock: TempoSourceClock;
    timeline: TempoTimeline;
};
