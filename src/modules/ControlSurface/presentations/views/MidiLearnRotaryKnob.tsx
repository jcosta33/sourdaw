import { type MouseEvent, type ReactElement } from 'react';

import { RotaryKnob, type RotaryKnobProps } from '#/components/daw/RotaryKnob';
import { useStore } from '#/infra/store/useStore';

import {
    midiLearnStore,
    defaultMidiLearnState,
    type LearningTarget,
    type MidiLearnState,
} from '../../stores/midiLearnStore';
import { findMappingForTarget } from '../../useCases/midiLearn/findMappingForTarget';
import { removeMapping } from '../../useCases/midiLearn/removeMapping';
import { startMidiLearn } from '../../useCases/midiLearn/startMidiLearn';
import { stopMidiLearn } from '../../useCases/midiLearn/stopMidiLearn';

// Discriminated on `targetType` so an incomplete target cannot type-check
// (F-11): `fermenterGlobalParam` is the only variant that needs neither
// `trackId` nor `deviceId` (handleMidiMessage routes it by device presence,
// not by track), so it is the only one with a default and no required
// companion props. No `trackId` sentinel is substituted for it — a consumer
// that means `trackGain`/`trackPan`/`deviceParam` must supply the props that
// target actually requires, or the JSX fails to compile.
type MidiLearnRotaryKnobTarget =
    | { targetType?: 'fermenterGlobalParam'; trackId?: string; deviceId?: undefined }
    | { targetType: 'trackGain' | 'trackPan'; trackId: string; deviceId?: undefined }
    | { targetType: 'deviceParam'; trackId: string; deviceId: string };

type MidiLearnRotaryKnobProps = RotaryKnobProps & MidiLearnRotaryKnobTarget;

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
    const target: LearningTarget = { targetType, trackId, deviceId, paramId };
    const isLearning = Boolean(
        paramId && midiLearnState.isLearning && isSameTarget(midiLearnState.learningTarget, target)
    );
    const existingMapping = paramId ? findMappingForTarget(target) : undefined;
    const isMapped = Boolean(existingMapping);

    const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
        if (!paramId) {
            return;
        }

        event.preventDefault();

        // Right-click on an armed knob cancels the pending learn instead of
        // re-arming it (F-10) — mirrors MidiLearnButton's click behavior.
        if (isLearning) {
            stopMidiLearn();
            return;
        }

        // Alt+right-click on an already-mapped, non-learning knob removes the
        // single mapping instead of starting a new learn (F-10) — the panic
        // clear-all was previously the only way to drop one binding.
        if (event.altKey && existingMapping) {
            removeMapping(existingMapping.id);
            return;
        }

        startMidiLearn(target);
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
