export type MidiMappingActionSnapshot = {
    readonly id: string;
    readonly channel: number;
    readonly cc: number;
    readonly targetType: 'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam';
    readonly trackId?: string;
    readonly deviceId?: string;
    readonly paramId?: string;
    readonly minValue: number;
    readonly maxValue: number;
    readonly scaleMode?: 'linear' | 'log' | 'exp';
};
export type MidiLearnMappingsActionSnapshot = {
    readonly mappings: readonly MidiMappingActionSnapshot[];
};

export type ControlSurfaceAppAction =
    | { type: 'clearAllMidiMappings'; payload?: undefined }
    | { type: 'completeMidiLearn'; payload: { channel: number; cc: number; mappingId: string } }
    | { type: 'removeMidiMapping'; payload: { mappingId: string } }
    | {
          type: 'restoreMidiLearnMappings';
          payload: { expected: MidiLearnMappingsActionSnapshot; replacement: MidiLearnMappingsActionSnapshot };
      }
    | { type: 'setControlSurface'; payload: { protocol: 'mcu' | 'osc' | 'hui' | null } }
    | { type: 'connectPush'; payload: { model: 'push2' | 'push3' } }
    | { type: 'disconnectPush'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        controlSurface: ControlSurfaceAppAction;
    }
}
