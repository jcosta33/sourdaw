import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";

const logger = Container.getInstance().get(Logger);

export type MidiMappingTargetType = "trackGain" | "trackPan" | "deviceParam";

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

export const midiLearnStore = new Store<MidiLearnState>(logger, {
    initialData: {
        mappings: [],
        isLearning: false,
        learningTarget: null,
    },
});
