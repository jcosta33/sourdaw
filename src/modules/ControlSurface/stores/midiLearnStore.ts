import { createStore } from '#/infra/store/createStore';

export type MidiMappingTargetType = 'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam';

/**
 * How a raw 7-bit MIDI value (0–127) is mapped across [minValue, maxValue]:
 * - `linear`: equal increments (correct for pan and most device params).
 * - `log`:    perceptual taper — fast near the top — appropriate for gain/volume,
 *             where a linear fader feels heavily weighted toward the loud end.
 * - `exp`:    inverse taper — fast near the bottom — for params that need fine
 *             control at the low end.
 */
export type MidiMappingScaleMode = 'linear' | 'log' | 'exp';

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
    /** Curve applied between minValue and maxValue. Absent ⇒ treated as 'linear'. */
    scaleMode?: MidiMappingScaleMode;
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
