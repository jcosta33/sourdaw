import { type MouseEvent, type ReactElement } from 'react';

import { RotaryKnob, type RotaryKnobProps } from '#/components/daw/RotaryKnob';
import { useStore } from '#/infra/store/useStore';

import {
    midiLearnStore,
    type LearningTarget,
    type MidiLearnState,
    type MidiMappingTargetType,
} from '../../stores/midiLearnStore';
import { findMappingForTarget } from '../../useCases/midiLearn/findMappingForTarget';
import { startMidiLearn } from '../../useCases/midiLearn/startMidiLearn';

type MidiLearnRotaryKnobProps = RotaryKnobProps & {
    targetType?: MidiMappingTargetType;
    trackId?: string;
    deviceId?: string;
};

const defaultMidiLearnState: MidiLearnState = {
    mappings: [],
    isLearning: false,
    learningTarget: null,
};

function isSameTarget(left: LearningTarget | null, right: LearningTarget): boolean {
    return (
        left?.targetType === right.targetType &&
        left.trackId === right.trackId &&
        left.deviceId === right.deviceId &&
        left.paramId === right.paramId
    );
}

export const MidiLearnRotaryKnob = ({
    paramId,
    targetType = 'fermenterGlobalParam',
    trackId,
    deviceId,
    ...props
}: MidiLearnRotaryKnobProps): ReactElement => {
    const midiLearnState = useStore<MidiLearnState>(midiLearnStore, defaultMidiLearnState);
    const target = {
        targetType,
        trackId: trackId ?? 'global',
        deviceId,
        paramId,
    } satisfies LearningTarget;
    const isLearning = Boolean(
        paramId && midiLearnState.isLearning && isSameTarget(midiLearnState.learningTarget, target)
    );
    const isMapped = Boolean(paramId && findMappingForTarget(target));

    const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
        if (!paramId) {
            return;
        }

        event.preventDefault();
        startMidiLearn({
            targetType,
            paramId,
            trackId: target.trackId,
            deviceId: target.deviceId,
        });
    };

    return (
        <RotaryKnob
            {...props}
            paramId={paramId}
            isLearning={isLearning}
            isMapped={isMapped}
            onContextMenu={paramId ? handleContextMenu : undefined}
        />
    );
};
