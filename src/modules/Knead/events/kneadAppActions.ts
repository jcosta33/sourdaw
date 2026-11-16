import { type KneadPitchBlobSnapshot, type PitchContourSnapshot } from '#/utils/handlerContract';

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
           *  `describe()`. Every field past `clipId` is optional: the commit skips the
           *  buffer repoint on the native render path, and a clip can legitimately have
           *  had no blobs or no contour. */
          type: 'restoreClipFileId';
          payload: {
              clipId: string;
              fileId: string;
              audioBufferId?: string;
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
