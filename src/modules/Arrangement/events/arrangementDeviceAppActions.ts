import { type AutomationRecordingPolicy } from '#/modules/Automation/events';
import { type DeviceParameterValueUnit } from '#/utils/deviceParameterValueUnit';

import { type DeviceSnapshot } from '../models/DeviceSnapshot';

import { type DeviceStateChunkSnapshot } from './arrangementDeviceStateSnapshots';
import { type TrackKind } from './arrangementTrackSnapshots';

export type BatchRestoreDeviceSnapshot = {
    readonly trackId: string;
    readonly deviceId: string;
    readonly deviceIndex: number;
};

export type ArrangementDeviceAppAction =
    | {
          type: 'addDevice';
          payload: {
              trackId: string;
              deviceType: string;
              afterDeviceId?: string;
              deviceId?: string;
              expectedDeviceIds?: readonly string[];
              /** Internal AI replay guard. Provider payloads cannot set this field. */
              expectedFrozen?: boolean;
          };
      }
    | { type: 'bypassDevice'; payload: { deviceId: string; bypassed: boolean } }
    | {
          type: 'removeDevice';
          payload: {
              deviceId: string;
              expectedTrackId?: string;
              expectedDeviceIds?: readonly string[];
              /** Internal AI replay guard. Provider payloads cannot set this field. */
              expectedFrozen?: boolean;
          };
      }
    | {
          /** Inverse of `removeDevice`; emitted only from the device handler's pre-execute snapshot. */
          type: 'restoreDevice';
          payload: {
              trackId: string;
              deviceSnapshot: DeviceSnapshot;
              deviceIndex: number;
              expectedDeviceIds?: readonly string[];
              /** Internal grouped-history context for compositionally restoring sibling devices. */
              batchRestoreDevices?: readonly BatchRestoreDeviceSnapshot[];
          };
      }
    | {
          /**
           * Application-compiled device-chain move. The provider and presentation layers
           * supply only device identities; the Arrangement compiler owns this exact
           * project/topology binding and the handler retains it for undo/redo.
           */
          type: 'reorderDevices';
          payload: {
              trackId: string;
              deviceId: string;
              targetIndex: number;
              expectedBefore: {
                  id: string;
                  kind: TrackKind;
                  devices: readonly {
                      id: string;
                      type: string;
                      externalInstanceId?: string;
                      parameterIds: readonly string[];
                  }[];
              };
              /** Present on the initial application-issued command; replay uses topology guards. */
              expectedProjectRevision?: string;
          };
      }
    | {
          type: 'setDeviceParameter';
          payload: {
              deviceId: string;
              paramId: string;
              value: number;
              /** Descriptor-backed native unit for model-authored parameter values. */
              valueUnit?: DeviceParameterValueUnit;
              expectedTrackId?: string;
              expectedDeviceType?: string;
              expectedDeviceIds?: readonly string[];
              expectedValue?: number;
              expectedValuePresent?: boolean;
              expectedTrackFrozen?: boolean;
              /** Internal replay flag: restore the parameter map to an absent property. */
              deleteParameter?: boolean;
              automationRecordingPolicy?: AutomationRecordingPolicy;
          };
      }
    | {
          type: 'setExternalPluginState';
          payload:
              | {
                    intent: 'capture';
                    deviceId: string;
                    stateChunk: string;
                    expectedInstanceId: string;
                    expectedStateChunk: string | null;
                }
              | { intent: 'replacement'; deviceId: string; stateChunk: string };
      }
    | { type: 'setDeviceState'; payload: { deviceId: string; state: DeviceStateChunkSnapshot } }
    | {
          type: 'setSend';
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           */
          payload: {
              trackId: string;
              busId: string;
              /** Stored linear amplitude. Exactly one of `level`, `levelDb`, `deltaDb`. */
              level?: number;
              /** Absolute send level in decibels. */
              levelDb?: number;
              /** Change relative to the send's live level, in decibels. */
              deltaDb?: number;
              /** New tap point; omitted keeps the send's current one. */
              preFader?: boolean;
              expectedLevel?: number;
              expectedPreFader?: boolean;
          };
      }
    | {
          type: 'addSend';
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           */
          payload: {
              trackId: string;
              busId: string;
              /** Stored linear amplitude. Exactly one of `level`, `levelDb`, `deltaDb`. */
              level?: number;
              /** Absolute send level in decibels. */
              levelDb?: number;
              /** Change relative to unity, in decibels: the send does not exist yet. */
              deltaDb?: number;
              preFader?: boolean;
              expectedAbsent?: true;
          };
      }
    | {
          type: 'removeSend';
          payload: { trackId: string; busId: string; expectedLevel?: number; expectedPreFader?: boolean };
      }
    | { type: 'loadExternalPlugin'; payload: { pluginId: string; trackId?: string } }
    | {
          type: 'addSidechainRoute';
          payload: {
              sourceTrackId: string;
              targetTrackId: string;
              /** Command-owned replay identity and route snapshot fields. AiRuntime may select an app-scoped device. */
              routeId?: string;
              targetDeviceId?: string;
              targetParameterId?: string;
              gain?: number;
          };
      }
    | {
          type: 'removeSidechainRoute';
          payload: {
              sourceTrackId: string;
              targetTrackId: string;
              /** Command-owned replay identity and exact removed route snapshot. AiRuntime exposes only endpoints. */
              routeId?: string;
              targetDeviceId?: string;
              targetParameterId?: string;
              gain?: number;
          };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementDevice: ArrangementDeviceAppAction;
    }
}
