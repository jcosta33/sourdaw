import { type ReactElement, useSyncExternalStore } from 'react';
import { Mic } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/helpers/Styles/cn';
import { voiceStatusStore } from '#/modules/AiRuntime/stores/voiceStatusStore';
import { isSpeechRecognitionAvailable } from '#/modules/AiRuntime/presentations/views/VoiceCommandOverlay';
import { isTauri } from '#/helpers/tauriBridge';

const subscribeVoice = (cb: () => void): (() => void) => voiceStatusStore.subscribe(() => cb());
const getVoiceSnapshot = () => voiceStatusStore.value ?? { isListening: false, transcribing: false };

const isVoiceAvailable = (): boolean => isSpeechRecognitionAvailable() || isTauri();

export const VoiceButton = (): ReactElement | null => {
    const voice = useSyncExternalStore(subscribeVoice, getVoiceSnapshot, getVoiceSnapshot);

    if (!isVoiceAvailable()) {
        return null;
    }

    const active = voice.isListening || voice.transcribing;

    const handleClick = () => {
        document.dispatchEvent(new CustomEvent('sourdaw:toggle-voice-command'));
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
                    className={cn(
                        'transition-all',
                        active && 'text-[var(--color-state-danger)] ring-1 ring-[var(--color-state-danger)]/40 bg-[var(--color-state-danger)]/10'
                    )}
                >
                    <Mic
                        className={cn('size-3.5', active && 'animate-pulse')}
                        aria-hidden="true"
                    />
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                {active ? 'Listening… click to stop' : 'Voice command (hold V)'}
            </TooltipContent>
        </Tooltip>
    );
};
