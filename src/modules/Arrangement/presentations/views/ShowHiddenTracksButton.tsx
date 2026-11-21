import { type ReactElement } from 'react';

import { Eye, EyeOff } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

type ShowHiddenTracksButtonProps = {
    hiddenCount: number;
    pressed: boolean;
    onToggle: () => void;
};

export const ShowHiddenTracksButton = ({
    hiddenCount,
    pressed,
    onToggle,
}: ShowHiddenTracksButtonProps): ReactElement => {
    const label = `Show hidden tracks (${hiddenCount})`;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={label}
                    aria-pressed={pressed}
                    disabled={hiddenCount === 0 && !pressed}
                    data-testid="show-hidden-tracks-toggle"
                    className="aria-pressed:bg-surface-well aria-pressed:text-[var(--color-accent-lavender)]"
                    onClick={onToggle}
                >
                    {pressed ? (
                        <Eye className="size-3" aria-hidden="true" />
                    ) : (
                        <EyeOff className="size-3" aria-hidden="true" />
                    )}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
};
