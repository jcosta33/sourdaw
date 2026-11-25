/** A pitch-shift segment carried by `commitPitchEdit`. Command cannot import Knead's
 *  segment model (model isolation), so this specifies only the structural fields the
 *  pitch render consumes. Kept assignable to Knead's mutable shape (plain arrays). */
export type PitchEditSegmentSnapshot = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

export type KneadAppAction =
    | {
          /** Applies a manual pitch-shift render to an audio clip and swaps the clip's
           *  file pointer to the rendered output. Flows through `executeAppAction`; its
           *  handler's `describe()` emits `restoreClipFileId` as the inverse. */
          type: 'commitPitchEdit';
          payload: {
              clipId: string;
              segments: PitchEditSegmentSnapshot[];
              contour: PitchContourSnapshot;
              retuneSpeedMs?: number;
              formantPreserve?: boolean;
          };
      }
    | {
          /** Inverse of `commitPitchEdit`. Restores everything the commit consumed:
           *  the clip's file pointer, the buffer it plays from, and the pitch analysis
           *  (contour plus the user's edited blobs) the commit dropped. Restoring the
           *  pointers alone would leave the clip un-analysed and the user's blob edits
           *  gone — a lossy undo. Emitted only by the `commitPitchEdit` handler's
           *  `describe()`. Every field past `clipId` is optional: a clip can legitimately
           *  have had no blobs or no contour, and entries recorded before the buffer
           *  field could say "absent" carry no value for it. */
          type: 'restoreClipFileId';
          payload: {
              clipId: string;
              fileId: string;
              /** A string restores that buffer; `null` removes the clip's buffer id
               *  (the pre-edit clip had none); absent leaves it untouched, which is
               *  how inverses recorded before `null` existed still behave. */
              audioBufferId?: string | null;
              blobs?: KneadPitchBlobSnapshot[];
              contour?: PitchContourSnapshot;
          };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        knead: KneadAppAction;
    }
}

/** A pitch-contour point carried by `commitPitchEdit`. Structural mirror of Knead's
 *  `PitchPoint` — model isolation forbids importing the concrete model. */
export type PitchContourPointSnapshot = {
    time_ms: number;
    frequency_hz: number;
    confidence: number;
    voiced: boolean;
};
/** The analysed pitch contour carried by `commitPitchEdit`. Structural mirror of Knead's
 *  `PitchContour`; arrays stay mutable so the payload is assignable where the render
 *  dependency expects Knead's concrete type. */
export type PitchContourSnapshot = {
    points: PitchContourPointSnapshot[];
    sample_rate: number;
    hop_size: number;
    algorithm?: string;
};
/** An editable Knead pitch blob carried by `restoreClipFileId` so undoing a pitch
 *  commit gives the user their edits back. Structural mirror of Knead's `NoteBlob`
 *  — model isolation forbids importing the concrete model.
 *
 *  Deliberately NOT the reduced blob shape on `ClipActionSnapshot.kneadState`: that
 *  one omits drift, vibrato, formant shift, gain and mute, and an undo restoring
 *  from it would silently discard those edits. A restore snapshot has to be lossless.
 *  `originalPitchCenterCents` stays optional because the persisted shape omits it. */
export type KneadPitchBlobSnapshot = {
    id: string;
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    originalPitchCenterCents?: number;
    pitchCurveCents: number[];
    voicedConfidence: number;
    driftPercent: number;
    vibratoDepthPercent: number;
    vibratoRateHz: number;
    formantShiftCents: number;
    gainDb: number;
    muted: boolean;
};
