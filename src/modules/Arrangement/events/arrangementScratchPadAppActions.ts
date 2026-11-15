import { type MarkerSectionSnapshot, type ScratchPadSectionSnapshot } from './arrangementClipSnapshots';

export type ArrangementScratchPadAppAction =
    | {
          /** Inverse of `clearScratchPad` / `commitScratchPad`. Both discard authored
           *  state — the pad's sections, or the arrangement's existing marker sections —
           *  and neither is replayable, so both collections are carried and guarded. */
          type: 'restoreScratchPadState';
          payload: {
              expectedSections: readonly ScratchPadSectionSnapshot[];
              replacementSections: readonly ScratchPadSectionSnapshot[];
              expectedMarkerSections: readonly MarkerSectionSnapshot[];
              replacementMarkerSections: readonly MarkerSectionSnapshot[];
          };
      }
    | { type: 'commitScratchPad'; payload?: undefined }
    | { type: 'clearScratchPad'; payload?: undefined }
    | { type: 'removeScratchPadSection'; payload: { sectionId: string } }
    | { type: 'renameScratchPadSection'; payload: { sectionId: string; name: string } }
    | { type: 'reorderScratchPadSection'; payload: { sectionId: string; direction: 'left' | 'right' } }
    | { type: 'setScratchPadSectionColor'; payload: { sectionId: string; color: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementScratchPad: ArrangementScratchPadAppAction;
    }
}
