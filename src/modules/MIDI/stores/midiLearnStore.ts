import { createStore } from '#/infra/store/createStore';

export type MidiMappingTargetType = 'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam';

export type MidiMapping = {
    id: string;
    channel: number;
    cc: number;
    targetType: MidiMappingTargetType;
    trackId: string;
    deviceId?: string;
    paramId?: string;
    minValue: number;
    maxValue: number;
};

export type LearningTarget = {
    targetType: MidiMappingTargetType;
    trackId: string;
    deviceId?: string;
    paramId?: string;
};

export type MidiLearnState = {
    mappings: MidiMapping[];
    isLearning: boolean;
    learningTarget: LearningTarget | null;
};

export const midiLearnStore = createStore<MidiLearnState>({
    initialData: {
        mappings: [],
        isLearning: false,
        learningTarget: null,
    },
});
