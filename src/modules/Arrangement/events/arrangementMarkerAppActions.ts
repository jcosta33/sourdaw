export type ArrangementMarkerAppAction =
    | {
          type: 'addMarker';
          /** `index`, `beforeId` and `afterId` place the marker among its neighbours: before `beforeId`,
           *  else after `afterId`, else at `index` (clamped to the list length); absent appends.
           *  `removeMarker`'s inverse sets them so undo restores the order. */
          payload: {
              beat: number;
              name: string;
              markerId?: string;
              color?: string;
              index?: number;
              beforeId?: string;
              afterId?: string;
          };
      }
    | { type: 'removeMarker'; payload: { markerId: string } }
    | { type: 'setMarkerColor'; payload: { markerId: string; color: string; expectedColor?: string } }
    | {
          type: 'addSection';
          /** `index`, `beforeId` and `afterId` place the section among its neighbours: before `beforeId`,
           *  else after `afterId`, else at `index` (clamped to the list length); absent appends.
           *  `removeSection`'s inverse sets them so undo restores the order. */
          payload: {
              startBeat: number;
              endBeat: number;
              name: string;
              sectionId?: string;
              color?: string;
              index?: number;
              beforeId?: string;
              afterId?: string;
          };
      }
    | { type: 'removeSection'; payload: { sectionId: string } }
    | { type: 'renameSection'; payload: { sectionId: string; name: string } }
    | { type: 'renameMarker'; payload: { markerId: string; name: string } }
    | { type: 'moveMarker'; payload: { markerId: string; beat: number } }
    | { type: 'moveSection'; payload: { sectionId: string; startBeat: number } }
    | { type: 'resizeSection'; payload: { sectionId: string; startBeat: number; endBeat: number } }
    | { type: 'setSectionColor'; payload: { sectionId: string; color: string } }
    | { type: 'reorderSection'; payload: { sectionId: string; direction: 'left' | 'right' } }
    | {
          /** Internal guarded inverse for `reorderSection`: restores BOTH swapped
           *  sections' exact pre-reorder beat spans and list positions, the gap
           *  between them included. Emitted only by the reorder handler's
           *  `describe()` — never invoked directly. */
          type: 'restoreSectionBeats';
          payload: { sections: Array<{ sectionId: string; startBeat: number; endBeat: number; index: number }> };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementMarker: ArrangementMarkerAppAction;
    }
}
