import { type MidiClipNoteSnapshot } from './midiClipDataSnapshots';

export type GrooveConsumerSnapshot = 'clip' | 'yeast-processor' | 'toaster-pattern' | 'arpeggiator' | 'sequencer';
export type GrooveTemplateActionSnapshot = {
    id: string;
    name: string;
    schemaVersion: 1;
    subdivision: '1/8' | '1/16' | '1/32' | '1/16T';
    slots: Array<{ index: number; timingOffset: number; dynamicsOffset: number }>;
    provenance:
        | { type: 'builtin'; sourceId: string }
        | { type: 'user'; sourceId: string }
        | { type: 'midi-clip'; sourceId: string; analyzerVersion: number }
        | { type: 'legacy'; sourceId: string };
};
export type GrooveAssignmentActionSnapshot = {
    consumerType: GrooveConsumerSnapshot;
    consumerId: string;
    templateId: string;
    amount: number;
};
export type ChordQualityActionSnapshot =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';
export type ChordTrackActionSnapshot = {
    readonly enabled: boolean;
    readonly events: readonly {
        readonly id: string;
        readonly beat: number;
        readonly root: number;
        readonly quality: ChordQualityActionSnapshot;
        readonly duration: number;
    }[];
};
export type DeletedGrooveTemplateActionSnapshot = {
    template: GrooveTemplateActionSnapshot;
    templateIndex: number;
    assignments: Array<{ index: number; assignment: GrooveAssignmentActionSnapshot }>;
};
/** The rows one overdub pass adds to one clip, ids included. */
export type OverdubControllerRowsSnapshot = {
    readonly clipId: string;
    readonly cc: readonly {
        readonly id: string;
        readonly controller: number;
        readonly value: number;
        readonly beat: number;
        readonly channel: number;
    }[];
    readonly pitchBend: readonly {
        readonly id: string;
        readonly value: number;
        readonly beat: number;
        readonly channel: number;
        readonly channelScoped?: boolean;
    }[];
};
/**
 * The ids of the rows one overdub pass added to one clip, and whether each of the clip's
 * lists existed before the pass: the inverse drops only a list the pass created, so an empty
 * list stays empty and "no list" stays absent.
 */
export type OverdubControllerRowIds = {
    readonly clipId: string;
    readonly ccIds: readonly string[];
    readonly pitchBendIds: readonly string[];
    readonly ccListExisted: boolean;
    readonly pitchBendListExisted: boolean;
};
/** One original base-clip note, with the notes bucket's exact presence. */
export type OriginalMidiBaseRowReplacementPayload = {
    readonly clipId: string;
    readonly rowId: string;
    readonly expected: MidiClipNoteSnapshot | null;
    readonly replacement: MidiClipNoteSnapshot | null;
    readonly expectedSlotPresent: boolean;
    readonly replacementSlotPresent: boolean;
};

type MidiNoteEditWindow = { readonly startBeat: number; readonly endBeat: number };

export type MidiNoteEditScope = {
    readonly allowedNoteIds: readonly string[];
    readonly protectedNoteIds: readonly string[];
    readonly protectedWindows: readonly MidiNoteEditWindow[];
    readonly insertionWindows: readonly MidiNoteEditWindow[];
    readonly insertionBudget: number;
};

export type MidiNoteEditOperation =
    | {
          type: 'patch';
          noteId: string;
          patch: { pitch?: number; startBeat?: number; duration?: number; velocity?: number };
      }
    | { type: 'delete'; noteId: string }
    | { type: 'insert'; note: { id?: string; pitch: number; startBeat: number; duration: number; velocity?: number } };

export type EditMidiNotesPayload = {
    clipId: string;
    operations: MidiNoteEditOperation[];
    /** Only the application may attach this scope and its exact before-image. */
    guard: {
        readonly trackId: string;
        readonly expectedNotes: readonly MidiClipNoteSnapshot[];
        readonly expectedNotesBucketPresent: boolean;
        readonly selectionToken?: string;
        readonly editWindow: MidiNoteEditWindow;
        readonly scope: MidiNoteEditScope;
    };
};

export type MidiAppAction =
    | { type: 'editMidiNotes'; payload: EditMidiNotesPayload }
    | { type: 'replaceOriginalMidiBaseRow'; payload: OriginalMidiBaseRowReplacementPayload }
    | {
          type: 'quantizeNotes';
          payload: {
              clipId: string;
              gridSize: number;
              strength?: number;
              swing?: number;
              noteIds?: string[];
          };
      }
    | {
          type: 'removeShortMidiOverlaps';
          payload: {
              clipId: string;
              maximumOverlapMs: number;
              expectedTempo: number;
              expectedTrackId: string;
              trackName: string;
              expectedTrackFrozen: boolean;
              clipName: string;
              expectedClipLocked: boolean;
              expectedNotes: readonly MidiClipNoteSnapshot[];
          };
      }
    | {
          type: 'copyMidiArticulations';
          payload: {
              trackId: string;
              sourceClipId: string;
              targetClipId: string;
              notePairs: readonly { readonly sourceNoteId: string; readonly targetNoteId: string }[];
              expectedSourceNotes: readonly MidiClipNoteSnapshot[];
              expectedTargetNotes: readonly MidiClipNoteSnapshot[];
              expectedTrackFrozen: boolean;
              expectedSourceClipLocked: boolean;
              expectedTargetClipLocked: boolean;
          };
      }
    | {
          /** Internal inverse for whole-clip MIDI note transforms. Provider payloads never carry snapshots. */
          type: 'restoreMidiClipNotes';
          payload: {
              clipId: string;
              notes: readonly MidiClipNoteSnapshot[];
              expectedNotes: readonly MidiClipNoteSnapshot[];
              /** Whether the replacement snapshot owns a MIDI notes bucket, preserving absence versus present-empty. */
              notesBucketPresent?: boolean;
              /** Whether the expected snapshot owns a MIDI notes bucket, preserving absence versus present-empty. */
              expectedNotesBucketPresent?: boolean;
              /** Internal redo allowance for a newly recreated clip whose MIDI bucket does not exist yet. */
              allowMissingExpectedEmpty?: boolean;
              /** MF-03 replay eligibility captured from the approved source and clip topology. */
              articulationReplayGuard?: {
                  trackId: string;
                  sourceClipId: string;
                  expectedSourceNotes: readonly MidiClipNoteSnapshot[];
                  expectedTrackFrozen: boolean;
                  expectedSourceClipLocked: boolean;
                  expectedTargetClipLocked: boolean;
              };
              /** General guarded replay eligibility for deterministic whole-clip note transforms. */
              noteTransformReplayGuard?: {
                  trackId: string;
                  expectedTrackFrozen: boolean;
                  expectedClipLocked: boolean;
                  expectedTempo?: number;
              };
          };
      }
    | { type: 'quantizeNoteLengths'; payload: { clipId: string; gridSize: number; noteIds?: string[] } }
    | { type: 'transposeNotes'; payload: { clipId: string; semitones: number; noteIds?: string[] } }
    | {
          type: 'humanizeNotes';
          // `seed`/`velocityAmount` are optional and captured by the handler on
          // first execute, replayed on redo — kept in sync with
          // AiRuntime/models/RuntimeAction.ts.
          payload: { clipId: string; amount: number; velocityAmount?: number; seed?: number };
      }
    | { type: 'invertNotes'; payload: { clipId: string } }
    | { type: 'retrogradeNotes'; payload: { clipId: string } }
    | {
          type: 'scaleVelocities';
          payload: { clipId: string; curve: string; minVelocity?: number; maxVelocity?: number };
      }
    | { type: 'scaleAllVelocities'; payload: { clipId: string; factor: number } }
    | { type: 'setAllVelocities'; payload: { clipId: string; velocity: number } }
    | {
          type: 'createGrooveTemplate';
          payload: Omit<GrooveTemplateActionSnapshot, 'schemaVersion'>;
      }
    | { type: 'renameGrooveTemplate'; payload: { templateId: string; name: string } }
    | {
          type: 'restoreGrooveTemplateName';
          payload: { templateId: string; name: string; expectedName: string };
      }
    | {
          type: 'deleteGrooveTemplate';
          payload: {
              templateId: string;
              /** Set only by the inverse of `extractGroove`: delete the template only while it still
               *  equals this snapshot and nothing is assigned to it, and refuse otherwise. */
              expectedTemplate?: GrooveTemplateActionSnapshot;
          };
      }
    | { type: 'restoreDeletedGrooveTemplate'; payload: DeletedGrooveTemplateActionSnapshot }
    | { type: 'assignGrooveTemplate'; payload: GrooveAssignmentActionSnapshot }
    | {
          type: 'restoreGrooveAssignment';
          payload: {
              consumerType: GrooveConsumerSnapshot;
              consumerId: string;
              assignment: GrooveAssignmentActionSnapshot | null;
              expectedAssignment?: GrooveAssignmentActionSnapshot;
          };
      }
    | {
          type: 'extractGroove';
          // Two whole object shapes rather than an intersection: the generated argument schema
          // closes every object, so an intersection of objects would admit no payload at all.
          payload:
              | {
                    clipId: string;
                    templateId?: string;
                    sourceName?: string;
                    subdivision?: string;
                    proposal: GrooveTemplateActionSnapshot;
                    sourceRevision: string;
                }
              | {
                    clipId: string;
                    templateId?: string;
                    sourceName?: string;
                    subdivision?: string;
                    proposal?: undefined;
                    sourceRevision?: undefined;
                };
      }
    | { type: 'applyGroove'; payload: { clipId: string; grooveId: string; amount?: number } }
    | { type: 'enableMpe'; payload?: undefined }
    | { type: 'disableMpe'; payload?: undefined }
    | {
          type: 'addNotes';
          payload: {
              clipId: string;
              notes: Array<{
                  /** Internal replay identity. Provider note validation rejects this field. */
                  id?: string;
                  pitch: number;
                  startBeat: number;
                  duration: number;
                  velocity?: number;
                  /** Canonical handler materialization writes the default probability. */
                  probability?: number;
              }>;
          };
      }
    | {
          type: 'addChordEvent';
          payload: { beat: number; root: number; quality: string; duration?: number; eventId?: string };
      }
    | { type: 'moveChordEvent'; payload: { eventId: string; beat: number } }
    | {
          type: 'updateChordEvent';
          payload: {
              eventId: string;
              root?: number;
              quality?: ChordQualityActionSnapshot;
              duration?: number;
          };
      }
    | { type: 'removeChordEvent'; payload: { eventId: string } }
    | { type: 'toggleChordTrack'; payload?: { enabled?: boolean } }
    | { type: 'clearChordTrack'; payload?: undefined }
    | {
          type: 'restoreChordTrackState';
          payload: { expected: ChordTrackActionSnapshot; replacement: ChordTrackActionSnapshot };
      }
    | {
          /** The controller and pitch-bend rows one overdub pass recorded into
           *  clips that already held rows (a take the recorder opened no clip
           *  for), appended when the transport stops recording and ONE history
           *  entry for the whole pass. The payload carries the rows with the ids
           *  they keep, registered-parameter declarations included, so Undo
           *  (`removeOverdubControllers`) removes exactly them and Redo replays
           *  this action to put the same rows back. */
          type: 'appendOverdubControllers';
          payload: { clips: readonly OverdubControllerRowsSnapshot[] };
      }
    | {
          /** Inverse of `appendOverdubControllers`. Removes the named rows by id and
           *  leaves every other row of the clip, a peer's edit included, in place. */
          type: 'removeOverdubControllers';
          payload: { clips: readonly OverdubControllerRowIds[] };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        midi: MidiAppAction;
    }
}

export type MidiNotesSnapshot = readonly { readonly id: string }[];
export type MidiCcSnapshot = readonly { readonly id: string }[];
export type MidiPitchBendSnapshot = readonly { readonly id: string }[];
