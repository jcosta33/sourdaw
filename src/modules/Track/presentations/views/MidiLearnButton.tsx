import { type ReactElement, type MouseEvent, useSyncExternalStore } from 'react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { cn } from '#/helpers/Styles/cn';
import {
    midiLearnStore,
    type LearningTarget,
    type MidiMappingTargetType,
    type MidiLearnState,
} from '../../stores/midiLearnStore';
import { startMidiLearn, stopMidiLearn, findMappingForTarget } from '../../useCases/midiLearnUseCases';

type MidiLearnButtonProps = {
    targetType: MidiMappingTargetType;
    trackId: string;
    deviceId?: string;
    paramId?: string;
};

const subscribe = (callback: () => void): (() => void) => midiLearnStore.subscribe(() => callback());

const getSnapshot = (): MidiLearnState | null => midiLearnStore.value;

const isTargetMatch = (a: LearningTarget, b: LearningTarget): boolean => {
    return (
        a.targetType === b.targetType && a.trackId === b.trackId && a.deviceId === b.deviceId && a.paramId === b.paramId
    );
};

export const MidiLearnButton = ({ targetType, trackId, deviceId, paramId }: MidiLearnButtonProps): ReactElement => {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const target: LearningTarget = { targetType, trackId, deviceId, paramId };

    const isLearningThis =
        state?.isLearning === true && state.learningTarget !== null && isTargetMatch(state.learningTarget, target);

    const existingMapping = state ? findMappingForTarget(target) : undefined;

    const handleClick = (e: MouseEvent): void => {
        e.stopPropagation();

        if (isLearningThis) {
            stopMidiLearn();
        } else {
            startMidiLearn(target);
        }
    };

    const label = isLearningThis
        ? 'Listening for MIDI CC…'
        : existingMapping
          ? `MIDI CC ${existingMapping.cc} (ch ${existingMapping.channel + 1})`
          : 'MIDI Learn';

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
