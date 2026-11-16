import {
    type MidiCcSnapshot,
    type MidiClipCcSnapshot,
    type MidiClipNoteSnapshot,
    type MidiClipPitchBendSnapshot,
    type MidiNotesSnapshot,
    type MidiPitchBendSnapshot,
} from '#/modules/MIDI/events';
import { type AudioSourceSnapshot } from '#/utils/audioSourceTime';

import { type ClipStateSnapshot, type RetiredTakeLaneSnapshot } from './arrangementClipStateSnapshots';
import {
    type CompAudioSourceInputProof,
    type CompAudioSourceOwnerSnapshot,
    type OriginalMidiTakeRowCopy,
} from './arrangementClipSnapshots';

export type CompAudioSourcePromotionSnapshot = {
    readonly expected: CompAudioSourceOwnerSnapshot;
    readonly replacement: CompAudioSourceOwnerSnapshot;
    readonly sourceInputs: CompAudioSourceInputProof;
};
export type CompAudioSourceFieldPresenceSnapshot = {
    readonly expected: boolean;
    readonly replacement: boolean;
};
export type CompSelectionSpanSnapshot = {
    readonly startBeat: number;
    readonly endBeat: number;
    readonly takeId: string;
    readonly audioSource?: AudioSourceSnapshot;
};
/** One original row, addressed through its selected take and admitted frozen copies. */
export type OriginalMidiTakeRowReplacementPayload = {
    /** Only a new forward request may capture; history carries immutable witnessed copies. */
    readonly copyScope?: 'capture' | readonly OriginalMidiTakeRowCopy[];
    readonly laneId: string;
    readonly takeId: string;
    readonly sourceClipId: string;
    readonly rowId: string;
    readonly expectedSlotPresent: boolean;
    readonly replacementSlotPresent: boolean;
} & (
    | {
          readonly rowKind: 'note';
          readonly expected: MidiClipNoteSnapshot | null;
          readonly replacement: MidiClipNoteSnapshot | null;
      }
    | {
          readonly rowKind: 'cc';
          readonly expected: MidiClipCcSnapshot | null;
          readonly replacement: MidiClipCcSnapshot | null;
      }
    | {
          readonly rowKind: 'bend';
          readonly expected: MidiClipPitchBendSnapshot | null;
          readonly replacement: MidiClipPitchBendSnapshot | null;
      }
);

export type ArrangementTakeAppAction =
    | {
          /** Guarded self-inverse of comp take selection. Fresh intent carries a
           *  non-null `takeId`; replay also binds the captured lane owner and may
           *  use `null` to restore an empty selection. `expectedSelectedTakeId`
           *  optimistic-locks the lane's current selection: `undefined` asserts
           *  nothing, `null` asserts no take is selected. */
          type: 'selectTake';
          payload: {
              trackId: string;
              takeId: string | null;
              expectedLaneId?: string;
              expectedSelectedTakeId?: string | null;
          };
      }
    | { type: 'replaceOriginalMidiTakeRow'; payload: OriginalMidiTakeRowReplacementPayload }
    | {
          type: 'setCompRegion';
          payload: {
              trackId: string;
              startBeat: number;
              endBeat: number;
              takeId: string;
              /** Internal identity and state guards captured before Command's first await. */
              laneId?: string;
              expected?: readonly CompSelectionSpanSnapshot[];
              replacement?: readonly CompSelectionSpanSnapshot[];
              audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
              baseGapAudioSourceFieldPresence?: CompAudioSourceFieldPresenceSnapshot;
          };
      }
    | {
          type: 'removeCompRegion';
          payload: {
              trackId: string;
              startBeat: number;
              /** Owner-captured interval and source guards, never caller-authored snapshots. */
              laneId?: string;
              endBeat?: number;
              expected?: readonly CompSelectionSpanSnapshot[];
              replacement?: readonly CompSelectionSpanSnapshot[];
              audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
              baseGapAudioSourceFieldPresence?: CompAudioSourceFieldPresenceSnapshot;
          };
      }
    | {
          /** Guarded interval replay emitted by a comp interval edit. */
          type: 'restoreCompRegionInterval';
          payload: {
              laneId: string;
              trackId: string;
              startBeat: number;
              endBeat: number;
              expected: readonly CompSelectionSpanSnapshot[];
              replacement: readonly CompSelectionSpanSnapshot[];
              audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
              baseGapAudioSourceFieldPresence?: CompAudioSourceFieldPresenceSnapshot;
          };
      }
    | {
          /** One completed recording gesture: the recorded clip materialized in
           *  its track as ONE history entry. The provisional clip, take lane, and
           *  takes the recorder opens while capture runs carry no history of their
           *  own, and this action is dispatched only once the capture succeeds, so
           *  an incomplete capture commits nothing. Its inverse is
           *  `discardRecording` and its explicit redo is `restoreRecording`, so one
           *  undo removes the clip together with its take-lane membership and one
           *  redo puts the same clip identity, placement, and take membership
           *  back. */
          type: 'commitRecording';
          payload: {
              /** The recorded clip exactly as it must stand after the commit,
               *  including its final placement and its captured media reference. */
              clip: ClipStateSnapshot;
          };
      }
    | {
          /** Inverse of `commitRecording`. Removes the recorded clip and retires
           *  the takes naming it through the ordinary clip-retirement path,
           *  leaving pre-existing lanes and unrelated edits in place. */
          type: 'discardRecording';
          payload: { clipId: string };
      }
    | {
          /** Explicit redo of `commitRecording`. Carries the clip and the take-lane
           *  state the removal retired, so the replay restores the same clip
           *  identity, the same placement, and the same take membership without
           *  starting another capture. */
          type: 'restoreRecording';
          payload: {
              clip: ClipStateSnapshot;
              retiredTakeLanes: readonly RetiredTakeLaneSnapshot[];
              /** The clip's MIDI data, which the removal inverse deletes with
               *  the clip. Mirrors `restoreClip`'s snapshots so a recorded MIDI
               *  take comes back with its notes, controller, and pitch-bend
               *  state rather than empty. */
              midiNotesSnapshot: MidiNotesSnapshot | null;
              midiCcSnapshot: MidiCcSnapshot | null;
              midiPitchBendSnapshot: MidiPitchBendSnapshot | null;
          };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementTake: ArrangementTakeAppAction;
    }
}
