import { type KeyboardEvent, type ReactElement } from 'react';

import { DawTransportCluster } from '#/components/daw/DawTransportCluster';
import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

import { type SoloMode } from '../../../models/WorkspaceState';
import { setSoloMode } from '../../../useCases/togglePanel/panelToggles/setSoloMode';

const SOLO_MODES: { value: SoloMode; label: string; description: string }[] = [
    {
        value: 'sip',
        label: 'SIP',
        description: 'Solo In Place — mutes non-soloed tracks',
    },
    {
        value: 'afl',
        label: 'AFL',
        description: 'After Fader Listen — solo with fader applied',
    },
    {
        value: 'pfl',
        label: 'PFL',
        description: 'Pre Fader Listen — solo at unity gain',
    },
];

const moveSoloModeRadio = (event: KeyboardEvent<HTMLButtonElement>, mode: SoloMode, select: boolean): void => {
    const nextKey = select ? 'ArrowDown' : 'ArrowRight';
    const previousKey = select ? 'ArrowUp' : 'ArrowLeft';
    if (event.key !== nextKey && event.key !== previousKey) {
        return;
    }
    const direction = event.key === nextKey ? 1 : -1;
    event.preventDefault();
    const index = SOLO_MODES.findIndex((option) => option.value === mode);
    const next = SOLO_MODES[(index + direction + SOLO_MODES.length) % SOLO_MODES.length];
    if (next === undefined) {
        return;
    }
    if (select) {
        setSoloMode(next.value);
    }
    const radios = event.currentTarget
        .closest('[role="radiogroup"]')
        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    const nextRadio = radios?.[(index + direction + SOLO_MODES.length) % SOLO_MODES.length];
    nextRadio?.focus();
};

type SoloModeSelectorProps = {
    soloMode: SoloMode;
    compact?: boolean;
};

export const SoloModeSelector = ({ soloMode, compact = false }: SoloModeSelectorProps): ReactElement => {
    if (compact) {
        return (
            <Popover>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="xs" aria-label={`Solo mode: ${soloMode.toUpperCase()}`}>
                                {soloMode.toUpperCase()}
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Solo mode: {soloMode.toUpperCase()}</TooltipContent>
                </Tooltip>
                <PopoverContent align="end" aria-label="Solo mode">
                    <div className="grid min-w-48 gap-1" role="radiogroup" aria-label="Solo mode">
                        {SOLO_MODES.map((message) => (
                            <Button
                                key={message.value}
                                variant={soloMode === message.value ? 'secondary' : 'ghost'}
                                size="sm"
                                role="radio"
                                aria-checked={soloMode === message.value}
                                tabIndex={soloMode === message.value ? 0 : -1}
                                onClick={() => setSoloMode(message.value)}
                                onKeyDown={(event) => moveSoloModeRadio(event, message.value, true)}
                            >
                                {message.label} — {message.description}
                            </Button>
                        ))}
                    </div>
                </PopoverContent>
            </Popover>
        );
    }

    return (
        <DawTransportCluster role="radiogroup" aria-label="Solo mode">
            {SOLO_MODES.map((message) => (
                <Tooltip key={message.value}>
                    <TooltipTrigger asChild>
                        <Button
                            variant={soloMode === message.value ? 'secondary' : 'ghost'}
                            size="xs"
                            role="radio"
                            aria-checked={soloMode === message.value}
                            tabIndex={soloMode === message.value ? 0 : -1}
                            data-testid={`solo-mode-${message.value}`}
                            onClick={() => setSoloMode(message.value)}
                            onKeyDown={(event) => moveSoloModeRadio(event, message.value, false)}
                            className={soloMode === message.value ? 'text-[var(--color-state-solo)]' : ''}
                        >
                            {message.label}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{message.description}</TooltipContent>
                </Tooltip>
            ))}
        </DawTransportCluster>
    );
};
