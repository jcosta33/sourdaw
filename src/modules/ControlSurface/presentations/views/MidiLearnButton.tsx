import { type ReactElement, type MouseEvent } from 'react';

import { Button } from '#/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { cn } from '#/utils/Styles/cn';

import {
    midiLearnStore,
    type LearningTarget,
    type MidiMappingTargetType,
    type MidiLearnState,
} from '../../stores/midiLearnStore';
import { findMappingForTarget } from '../../useCases/midiLearn/findMappingForTarget';
import { removeMapping } from '../../useCases/midiLearn/removeMapping';
import { startMidiLearn } from '../../useCases/midiLearn/startMidiLearn';
import { stopMidiLearn } from '../../useCases/midiLearn/stopMidiLearn';

type MidiLearnButtonProps = {
    targetType: MidiMappingTargetType;
    trackId: string;
    deviceId?: string;
    paramId?: string;
};

const defaultMidiLearnState: MidiLearnState = {
    mappings: [],
    isLearning: false,
    learningTarget: null,
};

function isTargetMatch(firstTarget: LearningTarget, secondTarget: LearningTarget): boolean {
    return (
        firstTarget.targetType === secondTarget.targetType &&
        firstTarget.trackId === secondTarget.trackId &&
        firstTarget.deviceId === secondTarget.deviceId &&
        firstTarget.paramId === secondTarget.paramId
    );
}

function getMidiLearnLabel(isLearningThis: boolean, existingMapping: ReturnType<typeof findMappingForTarget>): string {
    if (isLearningThis) {
        return 'Listening for MIDI CC...';
    }
    if (existingMapping) {
        return `MIDI CC ${existingMapping.cc} (ch ${existingMapping.channel + 1})`;
    }
    return 'MIDI Learn';
}

export const MidiLearnButton = ({ targetType, trackId, deviceId, paramId }: MidiLearnButtonProps): ReactElement => {
    const state = useStore(midiLearnStore, defaultMidiLearnState);

    const target: LearningTarget = { targetType, trackId, deviceId, paramId };

    const isLearningThis =
        state.isLearning === true && state.learningTarget !== null && isTargetMatch(state.learningTarget, target);

    const existingMapping = findMappingForTarget(target);

    const handleClick = (event: MouseEvent): void => {
        event.stopPropagation();

        if (isLearningThis) {
            stopMidiLearn();
            return;
        }

        // Alt+click on an already-mapped, non-learning control removes the
        // single mapping instead of starting a new learn (F-10) — the panic
        // clear-all was previously the only way to drop one binding.
        if (event.altKey && existingMapping) {
            removeMapping(existingMapping.id);
            return;
        }

        startMidiLearn(target);
    };

    const label = getMidiLearnLabel(isLearningThis, existingMapping);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={label}
                    aria-pressed={isLearningThis}
                    className={cn(
                        'size-5 text-[10px] font-bold',
                        isLearningThis && 'animate-pulse text-[var(--color-accent-peach)]',
                        !isLearningThis && existingMapping && 'text-[var(--color-accent-cyan)]'
                    )}
                    onClick={handleClick}
                >
                    {existingMapping && !isLearningThis ? existingMapping.cc : 'M'}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
};
