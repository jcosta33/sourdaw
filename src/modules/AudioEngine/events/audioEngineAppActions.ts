export type AudioEngineAppAction =
    | { type: 'getLatencyReport'; payload?: undefined }
    | { type: 'openElasticEditor'; payload: { clipId: string } }
    | { type: 'closeElasticEditor'; payload?: undefined }
    | { type: 'elasticSetSensitivity'; payload: { sensitivity: number } }
    | { type: 'elasticAddMarker'; payload: { clipId: string; localBeat: number } }
    | { type: 'elasticRemoveMarker'; payload: { markerId: string } }
    | { type: 'elasticToggleMarkerLock'; payload: { markerId: string } }
    | {
          type: 'elasticSetTool';
          payload: { tool: 'select' | 'add-marker' | 'remove-marker' | 'lock-marker' };
      }
    | { type: 'setWarpAlgorithm'; payload: { clipId: string; algorithm: string } }
    | { type: 'setWarpPitchShift'; payload: { clipId: string; semitones: number } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        audioEngine: AudioEngineAppAction;
    }
}
