export type BatchLocalActionIdentity =
    | {
          actionOrdinal: number;
          actionType: 'createBus';
          busId: string;
      }
    | {
          actionOrdinal: number;
          actionType: 'addDevice';
          deviceId: string;
      };
