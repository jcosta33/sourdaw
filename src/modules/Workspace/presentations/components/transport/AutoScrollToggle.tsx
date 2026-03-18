import { type ReactElement, useSyncExternalStore } from 'react';
import { ChevronsRight } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { timelineViewStore, toggleAutoScroll } from '#/modules/Timeline/stores/timelineViewStore';

export const AutoScrollToggle = (): ReactElement => {
    const autoScrollEnabled = useSyncExternalStore(
        (onChange) => timelineViewStore.subscribe(() => onChange()),
        () => timelineViewStore.value?.autoScrollEnabled ?? true,
        () => timelineViewStore.value?.autoScrollEnabled ?? true
    );

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant={autoScrollEnabled ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    aria-label="Auto-scroll follows playhead"
                    aria-pressed={autoScrollEnabled}
                    onClick={toggleAutoScroll}
                >
                    <ChevronsRight className="size-3.5" aria-hidden="true" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>Auto-scroll {autoScrollEnabled ? 'on' : 'off'}</TooltipContent>
        </Tooltip>
    );
};
