export type BatchLocalActionIdentity =
    | {
          actionOrdinal: number;
          actionType: 'createBus';
          busId: string;
          /** Application-owned initial fader value for a newly created bus. */
          initialGain?: number;
      }
    | {
          actionOrdinal: number;
          actionType: 'addDevice';
          deviceId: string;
      };
