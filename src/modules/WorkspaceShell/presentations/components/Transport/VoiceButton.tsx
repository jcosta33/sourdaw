import { type ReactElement } from 'react';

import { Mic } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/utils/Styles/cn';

type VoiceButtonProps = {
    isAvailable: boolean;
    isListening: boolean;
    isTranscribing: boolean;
    onToggle: (event: Event) => void;
};

export const VoiceButton = ({
    isAvailable,
    isListening,
    isTranscribing,
    onToggle,
}: VoiceButtonProps): ReactElement | null => {
    if (!isAvailable) {
        return null;
    }

    const active = isListening || isTranscribing;

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        onToggle(event.nativeEvent);
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={active ? 'Stop voice command' : 'Voice command (hold V)'}
                    aria-pressed={active}
                    onClick={handleClick}
                    data-testid="voice-command-button"
                    data-voice-command-control="true"
                    data-voice-command-intent={active ? 'stop' : 'start'}
                    className={cn(
                        'transition-all',
                        active &&
                            'text-[var(--color-state-danger)] ring-1 ring-[var(--color-state-danger)]/40 bg-[var(--color-state-danger)]/10'
                    )}
                >
                    <Mic className={cn('size-3.5', active && 'animate-pulse')} aria-hidden="true" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>{active ? 'Listening… click to stop' : 'Voice command (hold V)'}</TooltipContent>
        </Tooltip>
    );
};
