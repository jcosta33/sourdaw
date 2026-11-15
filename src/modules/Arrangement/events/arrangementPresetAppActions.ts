import { type DeviceSnapshot } from '../models/DeviceSnapshot';

import { type DeviceChainTopologySnapshot } from './arrangementTrackSnapshots';

export type ArrangementPresetAppAction =
    | {
          type: 'loadPreset';
          payload: {
              /** Preset-catalog identity retained for an execution-time authority check. */
              presetId: string;
              /** Application-owned target; omitted only before the preset compiler expands a new-track batch. */
              trackId: string;
              /** Captured ordered live/project chain before the one preset replacement. */
              expectedBefore: DeviceChainTopologySnapshot;
              /** Rejects a collaborator change before the project write. Consumed on first application. */
              expectedProjectRevision?: string;
              expectedFrozen: boolean;
              /** Exact app-materialized chain: ids, order, type, parameter schema and values. */
              devices: readonly DeviceSnapshot[];
          };
      }
    | {
          /** Internal guarded inverse emitted by `loadPreset`; never a presentation or provider command. */
          type: 'restorePresetDeviceChain';
          payload: {
              trackId: string;
              expectedBefore: DeviceChainTopologySnapshot;
              expectedFrozen: boolean;
              replacementDevices: readonly DeviceSnapshot[];
          };
      }
    | { type: 'savePreset'; payload: { trackId: string; name: string; category: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementPreset: ArrangementPresetAppAction;
    }
}
