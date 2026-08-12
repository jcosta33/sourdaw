export type BatchLocalActionIdentity =
    | {
          actionOrdinal: number;
          actionType: 'createBus';
          busId: string;
          /** Application-owned initial fader value for a newly created bus. */
          initialGain?: number;
          expectedAbsentTrackNames?: readonly string[];
          expectedTrackOutputs?: readonly { trackId: string; outputId: string }[];
      }
    | {
          actionOrdinal: number;
          actionType: 'addDevice';
          deviceId: string;
      };
