import { type ReactElement, useState } from 'react';

import { Loader2, Mic } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/utils/Styles/cn';

/**
 * The setup phases the enable-voice affordance renders. Mirrors
 * AiRuntime's `VoiceModelSetupStatus` structurally — leaf components must not
 * import business stores, so the view passes the store value in as props.
 * `null` hides the affordance entirely (the non-desktop runtime).
 */
export type VoiceSetupStatus =
    | { state: 'missing' }
    | { state: 'downloading'; progress: number }
    | { state: 'error'; message: string }
    | { state: 'ready' };

type VoiceButtonProps = {
    isAvailable: boolean;
    isListening: boolean;
    isTranscribing: boolean;
    onToggle: (event: Event) => void;
    setupStatus: VoiceSetupStatus | null;
    onEnableVoice: () => void;
};

const VoiceSetupProgress = ({ status }: { status: VoiceSetupStatus }): ReactElement => (
    <span
        role="status"
        data-testid="voice-setup-progress"
        className="inline-flex h-6 items-center gap-1 px-2 text-[10px] font-medium text-primary whitespace-nowrap tabular-nums"
    >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {status.state === 'downloading' ? `${String(Math.round(status.progress * 100))}%` : 'Enabling…'}
    </span>
);

type VoiceSetupAffordanceProps = {
    status: Extract<VoiceSetupStatus, { state: 'missing' } | { state: 'error' }>;
    onEnableVoice: () => void;
};

const VoiceSetupAffordance = ({ status, onEnableVoice }: VoiceSetupAffordanceProps): ReactElement => {
    const [setupOpen, setSetupOpen] = useState(false);
    const isError = status.state === 'error';
    return (
        <Popover open={setupOpen} onOpenChange={setSetupOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label="Enable voice input"
                    title={isError ? status.message : 'Enable voice input'}
                    data-testid="voice-setup-button"
                    className={cn('transition-all', isError && 'text-destructive/80 hover:text-destructive')}
                >
                    <Mic className="size-3.5" aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="center"
                sideOffset={8}
                aria-label="Voice input setup"
                className="daw-floating-surface w-[260px] p-0 overflow-y-auto rounded-xl"
            >
                <div className="px-3 pt-3 pb-2 border-b border-border/50 bg-surface-raised/50">
                    <span className="text-xs font-semibold text-foreground">Voice Input</span>
                </div>
                <div className="px-3 py-2.5 space-y-2">
                    {isError ? (
                        <p className="text-[10px] text-destructive/90 leading-relaxed" data-testid="voice-setup-error">
                            {status.message}
                        </p>
                    ) : null}
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Downloads and verifies the Whisper speech model (~148 MB) for private on-device transcription.
                    </p>
                    <Button
                        size="sm"
                        type="button"
                        className="w-full text-xs h-7"
                        data-testid={isError ? 'voice-setup-retry-button' : 'voice-setup-download-button'}
                        onClick={() => {
                            setSetupOpen(false);
                            // The click on this confirmation IS the consent
                            // gesture; the view turns it into
                            // `downloadConsent: true`.
                            onEnableVoice();
                        }}
                    >
                        {isError ? 'Retry Model Download' : 'Download & Enable'}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export const VoiceButton = ({
    isAvailable,
    isListening,
    isTranscribing,
    onToggle,
    setupStatus,
    onEnableVoice,
}: VoiceButtonProps): ReactElement | null => {
    if (!isAvailable) {
        if (setupStatus === null) {
            return null;
        }
        if (setupStatus.state === 'downloading' || setupStatus.state === 'ready') {
            return <VoiceSetupProgress status={setupStatus} />;
        }
        return <VoiceSetupAffordance status={setupStatus} onEnableVoice={onEnableVoice} />;
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
