import { type CommandSourceProof } from '#/modules/CrdtDocument/events';
import { type KneadPitchBlobSnapshot, type PitchContourSnapshot } from '#/modules/Knead/events';
import { type MidiClipNoteSnapshot } from '#/modules/MIDI/events';
import { type AudioSourceTile } from '#/utils/audioSourceTime';
import { type TempoSourceClock } from '#/utils/tempoSourceClock';

import {
    type ClipAutomationLaneActionSnapshot,
    type ClipShiftSnapshot,
    type GeneratedMidiStateGuard,
    type MidiClipGlueActionSnapshot,
    type StripSilenceActionSnapshot,
    type TransientQuantizeMoveSnapshot,
    type TransientQuantizeSkipSnapshot,
} from './arrangementClipSnapshots';
import {
    type ClipAutomationLaneSnapshot,
    type ClipSatelliteEntrySnapshot,
    type ClipSatelliteGainEnvelopeSnapshot,
    type ClipSplitActionSnapshot,
    type ClipStateSnapshot,
    type CompRegionSnapshot,
    type CompTakeLaneSnapshot,
    type RetiredTakeLaneSnapshot,
    type TakeSnapshot,
} from './arrangementClipStateSnapshots';
import { type TrackClipStateSnapshot } from './arrangementTrackSnapshots';

/** Identity-scoped row numbers captured by an executed slip or trim, without row snapshots. */
type MidiRowCoordinateCapture = {
    beatDelta: number;
    coordinates: {
        kind: 'note' | 'cc' | 'pitchBend';
        id: string;
        beforeBeat: number;
        afterBeat: number;
    }[];
};
export type ClipMoveActionSnapshot = {
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly automationLanes: readonly ClipAutomationLaneActionSnapshot[];
    readonly clipIndex?: number;
    readonly beforeClipId?: string;
    readonly afterClipId?: string;
};
/** One clip's target placement in a multi-clip move — the `moveClips` payload unit
 *  and the moved-clip half of its `restoreClipMoves` inverse. */
export type ClipMoveTarget = {
    readonly clipId: string;
    readonly trackId: string;
    readonly startBeat: number;
};
/** The neighbor shifts one ripple insert produced — the ripple half of `discardDrawnClip`'s payload. */
export type ClipRippleInsertPlanSnapshot = {
    readonly shiftedClips: readonly ClipShiftSnapshot[];
};
export type ClipStretchStateSnapshot = {
    readonly startBeat: number;
    readonly endBeat: number;
    readonly mode: { readonly present: boolean; readonly value: 'off' | 'repitch' | 'timestretch' };
    readonly ratio: { readonly present: boolean; readonly value: number };
};
/**
 * A global time operation's restore plan, as produced by `executeGlobalTimeOperation`.
 * Opaque here on purpose: the owning module encodes plans through its own codec, and
 * the only operations the command layer performs on one are transport and application.
 */
export type TimeOperationRestorePlanSnapshot = { readonly version: unknown };
export type ClipGlueActionSnapshot = {
    readonly trackId: string;
    readonly clips: readonly ClipStateSnapshot[];
    readonly clipOrder: readonly string[];
    readonly midi: MidiClipGlueActionSnapshot;
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
};
/** The application-materialized plan a transient quantize applies. It is a strip-silence-shaped
 *  clip replacement, bound to the decoded source and the tempo clock it was detected against. */
export type TransientQuantizePlanSnapshot = {
    readonly source: { readonly audioBufferId: string; readonly sampleRate: number; readonly length: number };
    readonly clock: TempoSourceClock;
    readonly expected: StripSilenceActionSnapshot;
    readonly replacement: StripSilenceActionSnapshot;
    readonly moves: readonly TransientQuantizeMoveSnapshot[];
    readonly skipped: readonly TransientQuantizeSkipSnapshot[];
};
/** One lane's take and comp-region facets before and after a clip transform —
 *  structural mirror of Arrangement's `TakeReKeyLaneTransition`, declared here
 *  because model isolation forbids importing it. */
export type TakeReKeyLaneTransitionSnapshot = {
    laneId: string;
    trackId: string;
    takesBefore: TakeSnapshot[];
    takesAfter: TakeSnapshot[];
    regionsBefore: CompRegionSnapshot[];
    regionsAfter: CompRegionSnapshot[];
    baseGapAudioSourcesBefore?: AudioSourceTile[];
    baseGapAudioSourcesAfter?: AudioSourceTile[];
};
/** An audio clip's canonical source clock, captured whole by an edit's inverse
 * and redo. Each key absent here is restored absent. */
export type ClipAudioSourceSnapshot = Pick<
    ClipStateSnapshot,
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
>;

export type ArrangementClipAppAction =
    | {
          /** Inverse of clip duplication. Removes the exact duplicate created by
           *  `duplicateClip` / `duplicateClipToNextBar` without applying the user's
           *  current ripple-delete mode. */
          type: 'discardDuplicatedClip';
          payload: {
              clipId: string;
              generatedMidiStateGuard?: GeneratedMidiStateGuard;
              /**
               * The take lanes this discard retired, written by its `execute()`
               * before `removeClip` runs. The paired redo re-creates the same clip
               * id, so the entry's own inverse is what carries the capture — across
               * the session mirror too, where a shared array would not survive.
               * Optional so entries persisted before takes joined this payload still
               * decode; absent means the discard recorded nothing.
               */
              retiredTakeLanes?: readonly RetiredTakeLaneSnapshot[];
          };
      }
    | {
          type: 'addClip';
          payload: {
              /** Internal replay identity. AiRuntime payload validation rejects this field. */
              id?: string;
              trackId: string;
              startBeat: number;
              endBeat: number;
              name: string;
              type?: 'audio' | 'midi';
              audioBufferId?: string;
              /** Internal clip state. AiRuntime payload validation rejects these fields. */
              assetHash?: string;
              isGhost?: boolean;
              audioOffsetBeats?: number;
              midiOffsetBeats?: number;
              fadeInBeats?: number;
              fadeOutBeats?: number;
              gain?: number;
              color?: string;
              locked?: boolean;
              muted?: boolean;
              stretchMode?: 'off' | 'repitch' | 'timestretch';
              stretchRatio?: number;
              loopEnabled?: boolean;
              loopLength?: number;
              followAction?: 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';
          };
      }
    | { type: 'moveClip'; payload: { clipId: string; trackId: string; startBeat: number } }
    | {
          /** Internal guarded inverse for exact clip track membership and geometry. */
          type: 'restoreClipPlacement';
          payload: {
              clipId: string;
              expected: ClipMoveActionSnapshot;
              replacement: ClipMoveActionSnapshot;
          };
      }
    | { type: 'duplicateClip'; payload: { clipId: string; targetClipId?: string } }
    | { type: 'duplicateClipToNextBar'; payload: { clipId: string; targetClipId?: string } }
    | { type: 'removeClip'; payload: { clipId: string; /** Internal captured replay preference. */ ripple?: boolean } }
    | { type: 'renameClip'; payload: { clipId: string; name: string } }
    | {
          type: 'splitClip';
          payload: {
              clipId: string;
              beat: number;
              /** Internal deterministic replay metadata. AiRuntime rejects these fields. */
              resolvedBeat?: number;
              rightClipId?: string;
              targetNoteIds?: readonly string[];
          };
      }
    | {
          /** Guarded inverse/redo for splitClip. Emitted only by its handler. */
          type: 'restoreClipSplitState';
          payload: {
              clipId: string;
              rightClipId: string;
              expected: ClipSplitActionSnapshot;
              replacement: ClipSplitActionSnapshot;
              /**
               * Shared holder for the take lanes the undo leg retires from the
               * right half, filled in place by `execute()` when it filters the
               * right clip out. The paired redo carries the same array, so the
               * redo can put back a take that landed on the right half after the
               * split. Optional so entries persisted before the field existed
               * still decode; absent means the undo records nothing and the redo
               * restores nothing.
               */
              retiredTakeLanes?: RetiredTakeLaneSnapshot[];
              retiredTakeSourceProof?: CommandSourceProof;
              /** Actual forward audio split publication; immutable through replay. */
              splitSourceProof?: CommandSourceProof;
              /**
               * Shared holder for the take/comp-region re-key the forward split
               * captured (#5048), filled in place by its `execute()`. The undo
               * leg restores the pre-split facets from it; the paired redo
               * re-applies them. Optional so entries persisted before the field
               * existed still decode; absent means neither leg re-keys lanes.
               */
              reKeyedTakeLanes?: TakeReKeyLaneTransitionSnapshot[];
          };
      }
    | {
          type: 'trimClipStart';
          payload: {
              clipId: string;
              newStartBeat: number;
              /**
               * The exact pre-action loop anchor the recorded inverse restores
               * (#5198): a value puts that anchor back and `null` restores "no
               * anchor", removing a key the action minted, so both replay
               * directions restore the pre-action state. Optional so entries
               * persisted before the field existed still decode; absent replays
               * the mint law they always did. AiRuntime-produced trims never
               * set it.
               */
              loopOriginBeat?: number | null;
              /**
               * The pre-action stored `midiOffsetBeats` a recorded inverse
               * restores verbatim (#5512). The trim's forward wrap derives its
               * loop length from the post-trim duration while the replay's wrap
               * derives from the post-restore duration, and on a
               * duration-derived loop (`loopLength` unset) those durations
               * differ, so the re-wrapping replay lands the stored rows a
               * trim-wrap distance from the figures the slip's own recorded
               * inverse then restores against. The capture keys the verbatim
               * restoration on this key's presence — zero included — the same
               * recorded-inverse law the slip's `rowLiftBeats` follows. Only
               * recorded inverses set it: a fresh dispatch never carries it,
               * and entries recorded before the field existed decode without it
               * and replay the re-wrapping law they always did.
               */
              midiOffsetBeats?: number;
              /** Owner-bound inverse/redo capture; never supplied by a fresh provider request. */
              midiRowCoordinates?: MidiRowCoordinateCapture;
          };
      }
    | { type: 'trimClipEnd'; payload: { clipId: string; newEndBeat: number } }
    | {
          /** Internal exact audio-head replay; never a public trim source override. */
          type: 'restoreAudioClipStartTrim';
          payload: {
              clipId: string;
              before: ClipStateSnapshot;
              after: ClipStateSnapshot;
              clock: TempoSourceClock;
              /** Complete source scope captured before trim; empty when the clip has no takes. */
              takeSourceTransitions: TakeReKeyLaneTransitionSnapshot[];
              direction: 'apply' | 'restore';
          };
      }
    | {
          /** Internal exact source slip replay; absent from public command discovery. */
          type: 'restoreAudioClipSlip';
          payload: {
              clipId: string;
              offset: number;
              before: { clip: ClipStateSnapshot; lanes: CompTakeLaneSnapshot[] };
              after: { clip: ClipStateSnapshot; lanes: CompTakeLaneSnapshot[] };
              clock: TempoSourceClock;
              direction: 'apply' | 'restore';
          };
      }
    | {
          type: 'slipClipContent';
          payload: {
              clipId: string;
              clipType: 'audio' | 'midi';
              offset: number;
              /**
               * The row shift a recorded inverse must apply to restore the rows
               * the forward slip's raising wrap lifted (#5198): the lift carried
               * negative, zero included — the replay keys verbatim restoration
               * on this key's presence, so a recorded inverse is never keyed
               * keyless. Only recorded inverses set it — a fresh dispatch is
               * keyless and keeps the forward wrap law, and entries recorded
               * before the field existed decode without it; the undo seams'
               * legacy normalizer re-keys those to the same verbatim
               * restoration (`rowLiftBeats: 0`).
               */
              rowLiftBeats?: number;
              /** Owner-bound inverse/redo capture; never supplied by a fresh provider request. */
              midiRowCoordinates?: MidiRowCoordinateCapture;
          };
      }
    | {
          /** Draw-tool clip creation; `ripple` shifts later clips on the track by the
           *  drawn length, exactly as the gesture's ripple insert did. */
          type: 'drawClip';
          payload: {
              /** Internal replay identity. AiRuntime payload validation rejects this field. */
              id?: string;
              trackId: string;
              startBeat: number;
              endBeat: number;
              name: string;
              type: 'audio' | 'midi';
              ripple: boolean;
          };
      }
    | {
          /** Inverse of `drawClip`. Removes the drawn clip and restores any
           *  ripple-shifted neighbors. Emitted only by the `drawClip` handler's
           *  `describe()` — not invoked directly. */
          type: 'discardDrawnClip';
          payload: {
              clipId: string;
              trackId: string;
              ripplePlan: ClipRippleInsertPlanSnapshot | null;
              /**
               * Shared holder for the take lanes this discard retires, filled in
               * place by its `execute()` before `removeClip` runs. The paired
               * `restoreDrawnClip` redo carries the same array, so the redo can put
               * back a take that landed on the drawn clip after the draw. Optional
               * so entries persisted before the field existed still decode; absent
               * means the discard records nothing and the redo restores nothing.
               */
              retiredTakeLanes?: RetiredTakeLaneSnapshot[];
          };
      }
    | {
          /** Redo of `drawClip`. Re-creates the drawn clip and re-applies the
           *  ripple plan captured at draw time — never re-plans against live
           *  state, so redo restores the forward placement whatever the current
           *  ripple preference is. Emitted only by the `drawClip` handler's
           *  `describe()` — not invoked directly. */
          type: 'restoreDrawnClip';
          payload: {
              clipId: string;
              trackId: string;
              startBeat: number;
              endBeat: number;
              name: string;
              type: 'audio' | 'midi';
              ripplePlan: ClipRippleInsertPlanSnapshot | null;
              /** The same shared holder `discardDrawnClip` fills; see there. */
              retiredTakeLanes?: RetiredTakeLaneSnapshot[];
          };
      }
    | {
          type: 'duplicateClipAt';
          payload: {
              clipId: string;
              destinationTrackId: string;
              startBeat: number;
              /** Internal replay identity. AiRuntime payload validation rejects this field. */
              targetClipId?: string;
          };
      }
    | {
          /** One multi-clip move gesture — plain and ripple commits alike. The
           *  handler computes each ripple plan between sequential writes, exactly
           *  as the callback loop did. */
          type: 'moveClips';
          payload: { moves: readonly ClipMoveTarget[]; ripple: boolean };
      }
    | {
          /** Inverse of `moveClips`. Restores every moved clip's placement and the
           *  pre-gesture positions of every ripple-shifted neighbor. Emitted only
           *  by the `moveClips` handler — not invoked directly. */
          type: 'restoreClipMoves';
          payload: { movedClips: readonly ClipMoveTarget[]; neighborShifts: readonly ClipShiftSnapshot[] };
      }
    | { type: 'setClipGainEnvelope'; payload: { clipId: string; envelope: ClipSatelliteGainEnvelopeSnapshot | null } }
    | { type: 'toggleClipGainEnvelope'; payload: { clipId: string; expectedEnabled?: boolean } }
    | {
          type: 'addGainEnvelopePoint';
          payload: { clipId: string; beatOffset: number; gainDb: number; pointId?: string };
      }
    | { type: 'removeGainEnvelopePoint'; payload: { clipId: string; pointId: string } }
    | { type: 'resetClipGainEnvelope'; payload: { clipId: string } }
    | { type: 'copyClip'; payload?: undefined }
    | { type: 'cutClip'; payload?: undefined }
    | { type: 'pasteClip'; payload?: undefined }
    | {
          type: 'setClipFade';
          payload: {
              clipId: string;
              fadeInBeats: number;
              fadeOutBeats: number;
              /** Internal stale-replay guards. AiRuntime payload validation rejects these fields. */
              expectedFadeInBeats?: number;
              expectedFadeOutBeats?: number;
          };
      }
    | { type: 'normalizeClip'; payload: { clipId: string; mode?: 'peak' | 'rms' | 'lufs'; targetDb?: number } }
    | {
          type: 'reverseClip';
          payload: {
              clipId: string;
              /**
               * Application-owned id for the reversed buffer this action mints, resolved
               * before dispatch so `describe()` can name the exact post-state its inverse
               * has to guard against. Minting it inside `execute` left the id unknowable
               * until after the undo entry was written. AiRuntime payload validation
               * rejects this field.
               */
              reversedBufferId?: string;
          };
      }
    | {
          /** Inverse and redo of `reverseClip`, in both directions. Reversing again is not
           *  self-inverse: each run mints a new buffer id, appends another name suffix and
           *  drops the clip's persisted pitch analysis, so undoing that way leaves changed
           *  metadata behind and destroys the user's Knead edits for good. This restores
           *  the buffer pointer, the name and the pitch analysis together, guarded on the
           *  buffer the forward action left behind (`expectedAudioBufferId`) so a newer
           *  edit conflicts instead of being overwritten. Emitted only by the
           *  `reverseClip` handler's `describe()`. */
          type: 'restoreReversedClip';
          payload: {
              clipId: string;
              expectedAudioBufferId: string;
              audioBufferId: string;
              name: string;
              /** Fades the restore puts back; optional so undo entries captured
               *  before reverse mirrored them still decode. */
              fadeInBeats?: number;
              fadeOutBeats?: number;
              /** Offset the restore puts back; optional so older undo entries still decode. */
              audioOffsetBeats?: number;
              /** Modern exact optional alias capture. Absent retains the older numeric/omitted contract. */
              audioOffsetBeatsCapture?: { present: false } | { present: true; value: number };
              /** Loop anchor the restore puts back; optional so older undo entries still decode. */
              loopOriginBeat?: number;
              /** Canonical source clock the restore puts back exactly. Present only for a
               *  clip carrying `audioOffsetSeconds`; absent leaves the live fields untouched,
               *  so beat-only clips and older undo entries restore as before. */
              audioSource?: ClipAudioSourceSnapshot;
              blobs?: KneadPitchBlobSnapshot[];
              contour?: PitchContourSnapshot;
          };
      }
    | {
          type: 'glueClips';
          payload: {
              clipIds: string[];
              /** Internal deterministic replay fields. AiRuntime validation rejects these fields. */
              targetClipId?: string;
              expected?: ClipGlueActionSnapshot;
              replacement?: ClipGlueActionSnapshot;
          };
      }
    | {
          type: 'restoreClipGlueState';
          payload: {
              expected: ClipGlueActionSnapshot;
              replacement: ClipGlueActionSnapshot;
          };
      }
    | { type: 'nudgeClip'; payload: { clipId: string; beats: number } }
    | { type: 'crossfadeClips'; payload: { clipAId: string; clipBId: string; durationBeats?: number } }
    | {
          type: 'restoreCrossfadeClips';
          payload: {
              clipAId: string;
              clipBId: string;
              expected: {
                  clipAEndBeat: number;
                  clipAFadeOutBeats: number;
                  clipBStartBeat: number;
                  clipBFadeInBeats: number;
                  clipBAudioOffsetBeats?: number;
                  clipBMidiOffsetBeats?: number;
                  /**
                   * The loop anchor the captured clip B carried, so the undo
                   * of a stretched crossfade restores the pre-crossfade anchor
                   * the forward leg displaced (#5198). Absent on legacy
                   * entries, which decode and restore exactly as before: the
                   * live anchor is left untouched.
                   */
                  clipBLoopOriginBeat?: number;
                  /**
                   * Clip B's canonical source clock, present only when clip B
                   * carries `audioOffsetSeconds`. The restore puts it back
                   * whole; legacy entries without it leave the live clock
                   * untouched.
                   */
                  clipBAudioSource?: ClipAudioSourceSnapshot;
              };
              replacement: {
                  clipAEndBeat: number;
                  clipAFadeOutBeats: number;
                  clipBStartBeat: number;
                  clipBFadeInBeats: number;
                  clipBAudioOffsetBeats?: number;
                  clipBMidiOffsetBeats?: number;
                  clipBLoopOriginBeat?: number;
                  clipBAudioSource?: ClipAudioSourceSnapshot;
              };
          };
      }
    | {
          type: 'setClipGain';
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           */
          payload: {
              clipId: string;
              /** Stored linear amplitude. Exactly one of `gain`, `gainDb`, `deltaDb`. */
              gain?: number;
              /** Absolute clip level in decibels. */
              gainDb?: number;
              /** Change relative to the clip's live gain, in decibels. */
              deltaDb?: number;
              /** Application-owned replay guard. AiRuntime payload validation rejects this field. */
              expectedGain?: number;
          };
      }
    | { type: 'setClipColor'; payload: { clipId: string; color: string; expectedColor?: string } }
    | { type: 'lockClip'; payload: { clipId: string; locked: boolean; expectedLocked?: boolean } }
    | { type: 'consolidateSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'bounceSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'exportMidi'; payload: { clipId: string } }
    | { type: 'setClipLoop'; payload: { clipId: string; enabled: boolean } }
    | {
          /** Internal exact-state replay for optional clip loop metadata. */
          type: 'restoreClipLoop';
          payload: {
              clipId: string;
              expected: {
                  present: boolean;
                  enabled: boolean;
                  /**
                   * The loop anchor the captured clip carried (#5198). Absent
                   * on legacy entries, which decode and behave exactly as
                   * before. The compare-and-swap guard reads only present and
                   * enabled: the anchor is inert while the loop is off, and a
                   * legacy expected snapshot must not conflict with a live
                   * anchor a later edit minted. `null` rides on entries whose
                   * captured clip carried none.
                   */
                  loopOriginBeat?: number | null;
              };
              replacement: {
                  present: boolean;
                  enabled: boolean;
                  /**
                   * The anchor to put back: the inverse of a loop disable
                   * restores the pre-disable anchor instead of the enable
                   * branch's restamp (#5198). `null` records a captured clip
                   * that carried no anchor, so the inverse of an enable
                   * removes the key the enable minted instead of leaving it on
                   * a never-looped clip. Absent — legacy entries — replays the
                   * enable's restamp exactly as before.
                   */
                  loopOriginBeat?: number | null;
              };
          };
      }
    | { type: 'setClipLoopLength'; payload: { clipId: string; loopLength: number } }
    | {
          /** Internal exact-state replay for optional clip loop-length metadata. */
          type: 'restoreClipLoopLength';
          payload: {
              clipId: string;
              expected: { present: boolean; value: number };
              replacement: { present: boolean; value: number };
          };
      }
    | { type: 'setClipStretchMode'; payload: { clipId: string; mode: 'off' | 'repitch' | 'timestretch' } }
    | { type: 'setClipStretchRatio'; payload: { clipId: string; ratio: number } }
    | {
          /** Internal guarded inverse for exact clip-stretch state and repitch geometry. */
          type: 'restoreClipStretchState';
          payload: {
              clipId: string;
              expected: ClipStretchStateSnapshot;
              replacement: ClipStretchStateSnapshot;
          };
      }
    | { type: 'fitClipToBeats'; payload: { clipId: string; targetBeats: number } }
    | { type: 'muteClip'; payload: { clipId: string; muted: boolean; expectedMuted?: boolean } }
    | { type: 'deleteTime'; payload: { startBeat: number; endBeat: number } }
    | { type: 'insertTime'; payload: { atBeat: number; durationBeats: number } }
    | { type: 'duplicateTimeRange'; payload: { startBeat: number; endBeat: number } }
    | {
          /** Inverse of a global time operation. The operation is not self-inverse —
           *  deleting time discards what it shifted over — so the forward handler hands
           *  its own restore plan here rather than replaying a counter-operation. The
           *  plan carries expected-and-replacement state and conflicts on divergence. */
          type: 'restoreTimeOperationState';
          payload: { plan: TimeOperationRestorePlanSnapshot };
      }
    | {
          /** Inverse of clip-collection rewrites (cut, paste, strip silence, flatten,
           *  consolidate). Replaying the forward edit cannot restore what it discarded,
           *  so each affected track's clips and MIDI satellites are carried whole and
           *  restored only while the live state still matches `expected`. */
          type: 'restoreTrackClipStates';
          payload: {
              expected: readonly TrackClipStateSnapshot[];
              replacement: readonly TrackClipStateSnapshot[];
          };
      }
    | {
          type: 'stripSilence';
          payload: {
              clipId: string;
              threshold?: number;
              minDuration?: number;
              /** Internal deterministic replay metadata. AiRuntime rejects these fields. */
              expected?: StripSilenceActionSnapshot;
              replacement?: StripSilenceActionSnapshot;
          };
      }
    | {
          type: 'restoreStripSilenceState';
          payload: {
              expected: StripSilenceActionSnapshot;
              replacement: StripSilenceActionSnapshot;
          };
      }
    | {
          type: 'arpeggiate';
          payload: {
              clipId: string;
              pattern?: string;
              rate?: number;
              octaves?: number;
              gate?: number;
              /** Application-owned EX-07 scope and compare-and-swap state. Provider payloads cannot carry these. */
              expectedTrackId?: string;
              trackName?: string;
              expectedTrackFrozen?: boolean;
              clipName?: string;
              expectedClipLocked?: boolean;
              expectedNotes?: readonly MidiClipNoteSnapshot[];
              addedNotes?: readonly MidiClipNoteSnapshot[];
          };
      }
    | { type: 'detectTransients'; payload: { clipId: string; sensitivity?: number } }
    | {
          type: 'quantizeTransients';
          payload: {
              clipId: string;
              /** Grid step in beats. */
              gridSize: number;
              strength?: number;
              swing?: number;
              sensitivity?: number;
              minConfidence?: number;
              /** Absolute beat range the onsets must start in, half-open. */
              startBeat?: number;
              endBeat?: number;
              /** Internal deterministic replay metadata. AiRuntime rejects it. */
              plan?: TransientQuantizePlanSnapshot;
          };
      }
    | { type: 'enableWarping'; payload: { clipId: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementClip: ArrangementClipAppAction;
    }
}
