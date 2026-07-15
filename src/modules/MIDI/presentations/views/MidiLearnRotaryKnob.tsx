import { type MouseEvent, type ReactElement } from 'react';

import { RotaryKnob, type RotaryKnobProps } from '#/components/daw/RotaryKnob';
import { useStore } from '#/infra/store/useStore';

import { midiLearnStore, type MidiLearnState, type MidiMappingTargetType } from '../../stores/midiLearnStore';
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

export const MidiLearnRotaryKnob = ({
    paramId,
    targetType = 'fermenterGlobalParam',
    trackId,
    deviceId,
    ...props
}: MidiLearnRotaryKnobProps): ReactElement => {
    const midiLearnState = useStore<MidiLearnState>(midiLearnStore, defaultMidiLearnState);
    const isLearning = Boolean(
        midiLearnState.isLearning &&
        midiLearnState.learningTarget &&
        midiLearnState.learningTarget.paramId === paramId &&
        paramId !== undefined
    );
    const isMapped = Boolean(midiLearnState.mappings.some((message) => message.paramId === paramId));

    const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
        if (!paramId) {
            return;
        }

        event.preventDefault();
        startMidiLearn({
            targetType,
            paramId,
            trackId: trackId ?? 'global',
            deviceId,
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
