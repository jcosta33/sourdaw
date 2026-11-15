import { type AdjustmentLayerSnapshot } from './arrangementClipSnapshots';

export type ArrangementBatchFeatureAppAction =
    | {
          /** Inverse of `createCompGroup`. Removes exactly the materialized group and
           *  restores the previously active group id, which creation overwrote. */
          type: 'discardCreatedCompGroup';
          payload: { groupId: string; expectedActiveGroupId: string | null; replacementActiveGroupId: string | null };
      }
    | {
          type: 'createCompGroup';
          /** `groupId` is application-owned and materialized before `describe`, so the
           *  inverse names the created group rather than guessing the newest one. */
          payload: { name: string; trackIds: string[]; groupId?: string };
      }
    | { type: 'createAdjustmentLayer'; payload: { name: string; effectType: string; layerId?: string } }
    | { type: 'removeAdjustmentLayer'; payload: { layerId: string } }
    | { type: 'toggleAdjustmentLayer'; payload: { layerId: string } }
    | { type: 'setLayerParameter'; payload: { layerId: string; paramName: string; value: number } }
    | { type: 'setLayerMix'; payload: { layerId: string; mix: number } }
    | {
          type: 'addAdjustmentRegion';
          payload: {
              layerId: string;
              startBeat: number;
              endBeat: number;
              blend?: number;
              fadeInBeats?: number;
              fadeOutBeats?: number;
              regionId?: string;
              sourceRegionId?: string;
              sourceSection?: { id: string; name: string; startBeat: number; endBeat: number };
              targetSection?: { id: string; name: string; startBeat: number; endBeat: number };
              expectedLayer?: AdjustmentLayerSnapshot;
              expectedTracks?: Array<{ trackId: string; trackName: string; frozen: boolean }>;
          };
      }
    | {
          type: 'removeAdjustmentRegion';
          payload: {
              layerId: string;
              regionId: string;
              expectedRegion?: {
                  id: string;
                  startBeat: number;
                  endBeat: number;
                  blend: number;
                  fadeInBeats: number;
                  fadeOutBeats: number;
              };
              expectedTracks?: Array<{ trackId: string; trackName: string; frozen: boolean }>;
          };
      }
    | { type: 'moveAdjustmentRegion'; payload: { regionId: string; startBeat: number; endBeat: number } }
    | { type: 'setLayerFades'; payload: { regionId: string; fadeInBeats: number; fadeOutBeats: number } }
    | { type: 'setLayerAffectedTracks'; payload: { layerId: string; trackIds: string[] } }
    | { type: 'setLayerInsertionIndex'; payload: { layerId: string; insertionIndex: number } }
    | {
          type: 'restoreAdjustmentLayerMutation';
          payload: {
              layers: readonly AdjustmentLayerSnapshot[];
              expectedLayersFingerprint: string;
              freezeTransitions: Array<{
                  trackId: string;
                  previousStatus: 'frozen';
                  expectedSourceSignature: string;
              }>;
          };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementBatchFeature: ArrangementBatchFeatureAppAction;
    }
}
