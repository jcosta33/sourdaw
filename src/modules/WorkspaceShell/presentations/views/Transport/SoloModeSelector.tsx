import { type ReactElement } from 'react';

import { DawTransportCluster } from '#/components/daw/DawTransportCluster';
import { Button } from '#/components/ui/button';
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

type SoloModeSelectorProps = {
    soloMode: SoloMode;
};

export const SoloModeSelector = ({ soloMode }: SoloModeSelectorProps): ReactElement => {
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
                            data-testid={`solo-mode-${message.value}`}
                            onClick={() => setSoloMode(message.value)}
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
