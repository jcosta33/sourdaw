import { type ReactElement } from 'react';
import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { type SoloMode } from '../../../models/WorkspaceState';
import { setSoloMode } from '../../../useCases/togglePanel/panelToggles';

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
        <DawControlStrip className="gap-0.5 rounded-sm px-1 py-0.5" role="radiogroup" aria-label="Solo mode">
            {SOLO_MODES.map((m) => (
                <Tooltip key={m.value}>
                    <TooltipTrigger asChild>
                        <Button
                            variant={soloMode === m.value ? 'secondary' : 'ghost'}
                            size="xs"
                            role="radio"
                            aria-checked={soloMode === m.value}
                            onClick={() => setSoloMode(m.value)}
                            className={soloMode === m.value ? 'text-[var(--color-state-solo)]' : ''}
                        >
                            {m.label}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{m.description}</TooltipContent>
                </Tooltip>
            ))}
        </DawControlStrip>
    );
};
