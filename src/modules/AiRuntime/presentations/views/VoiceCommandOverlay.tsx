/**
 * Voice command overlay — floating UI for active voice recording.
 * All recording lifecycle logic is in the useVoiceRecording hook.
 */
import { type ReactElement } from 'react';

import { Mic, MicOff } from 'lucide-react';

import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

import { useVoiceRecording } from '../hooks/useVoiceRecording';

export const VoiceCommandOverlay = (): ReactElement | null => {
    const voice = useVoiceRecording();

    if (!voice.isListening && !voice.transcribing && !voice.errorText) {
        return null;
    }

    const displayText = voice.errorText || voice.finalText + (voice.interimText ? ` ${voice.interimText}` : '');

    let statusText: ReactElement;
    if (voice.transcribing) {
        statusText = <p className="text-xs text-muted-foreground animate-pulse">Transcribing...</p>;
    } else if (voice.errorText) {
        statusText = <p className="text-xs text-[var(--color-state-warning)]">{voice.errorText}</p>;
    } else if (displayText) {
        statusText = <p className="text-xs text-foreground truncate">{displayText}</p>;
    } else {
        statusText = (
            <p className="text-xs text-muted-foreground animate-pulse">
                {voice.voiceMode === 'whisper' ? 'Recording...' : 'Listening...'}
            </p>
        );
    }

    return (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
            <div
                className={cn(
                    'pointer-events-auto flex items-center gap-3 rounded-full bg-surface-overlay/95 border px-4 py-2 shadow-xl backdrop-blur-sm',
                    voice.errorText ? 'border-[var(--color-state-warning)]/40' : 'border-[var(--color-state-danger)]/30'
                )}
            >
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    onClick={voice.stopListening}
                    className={cn(
                        'flex size-8 items-center justify-center rounded-full transition-colors',
                        voice.errorText
                            ? 'bg-[var(--color-state-warning)]/20'
                            : 'bg-[var(--color-state-danger)]/20 hover:bg-[var(--color-state-danger)]/30'
                    )}
                    aria-label="Stop voice input"
                >
                    {voice.isListening && !voice.errorText ? (
                        <Mic className="size-4 text-[var(--color-state-danger)] animate-pulse" />
                    ) : (
                        <MicOff className="size-4 text-muted-foreground" />
                    )}
                </Button>
                <div className="max-w-sm min-w-32">{statusText}</div>
                {!voice.errorText ? (
                    <DawInlineHint className="whitespace-nowrap bg-transparent px-0 py-0 text-muted-foreground/60">
                        tap mic to stop
                    </DawInlineHint>
                ) : null}
            </div>
        </div>
    );
};
