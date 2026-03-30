import { type ReactElement } from 'react';
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
        <div
            className="flex items-center gap-0.5 px-1 py-0.5 rounded-sm"
            style={{
                background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                border: '1px solid rgba(0,0,0,0.4)',
                borderBottom: '1px solid rgba(40,40,40,0.3)',
            }}
            role="radiogroup"
            aria-label="Solo mode"
        >
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
        </div>
    );
};
