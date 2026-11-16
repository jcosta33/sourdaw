import { type MidiCcSnapshot, type MidiNotesSnapshot, type MidiPitchBendSnapshot } from '#/modules/MIDI/events';
import { type CommandSourceProof } from '#/modules/CrdtDocument/events';

import { type RetiredTakeLaneSnapshot } from './arrangementClipStateSnapshots';
import { type ClipSnapshot, type RipplePlanSnapshot } from './arrangementClipSnapshots';
import { type RestoreTrackPayloadSnapshot } from './arrangementTrackSnapshots';

export type ArrangementRestoreAppAction =
    | {
          /** Inverse of `removeTrack`. Carries the removed track, every project reference
           *  rewritten by removal, and its satellite state. Emitted only by the
           *  `removeTrack` handler's `describe()` — not invoked directly. */
          type: 'restoreTrack';
          payload: RestoreTrackPayloadSnapshot;
      }
    | {
          /** Inverse of `removeClip`. Carries the removed clip and any ripple-shift plan
           *  needed to restore neighbour positions. Emitted only by the `removeClip`
           *  handler's `describe()` — not invoked directly. */
          type: 'restoreClip';
          payload: {
              clipId: string;
              trackId: string;
              clipSnapshot: ClipSnapshot;
              /** Original clip slot. Older entries without it append. */
              clipIndex?: number;
              /** Original owner order; absent in legacy captures that carried only an index. */
              clipOrder?: readonly string[];
              ripplePlan: RipplePlanSnapshot | null;
              midiNotesSnapshot: MidiNotesSnapshot | null;
              midiCcSnapshot: MidiCcSnapshot | null;
              midiPitchBendSnapshot: MidiPitchBendSnapshot | null;
              /**
               * Take lanes the removed clips left, captured before removal.
               * Optional so restore entries persisted before takes joined this
               * payload still decode; absent means the removal retired none.
               */
              retiredTakeLanes?: readonly RetiredTakeLaneSnapshot[];
              retiredTakeSourceProof?: CommandSourceProof;
          };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementRestore: ArrangementRestoreAppAction;
    }
}
