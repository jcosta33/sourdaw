export type ArrangementPatternInstanceAppAction =
    | {
          type: 'createPatternInstance';
          payload: { sourceClipId: string; targetTrackId: string; startBeat: number; targetClipId?: string };
      }
    | { type: 'detachPatternInstance'; payload: { clipId: string } }
    | {
          /** Exact link-field replay; never replaces clip content or MIDI material. */
          type: 'restorePatternInstanceLink';
          payload: {
              clipId: string;
              trackId: string;
              expected: {
                  parentClipId: { present: false } | { present: true; value: string };
                  overrides: { present: false } | { present: true; value: Record<string, boolean> };
              };
              replacement: {
                  parentClipId: { present: false } | { present: true; value: string };
                  overrides: { present: false } | { present: true; value: Record<string, boolean> };
              };
          };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementPatternInstance: ArrangementPatternInstanceAppAction;
    }
}
