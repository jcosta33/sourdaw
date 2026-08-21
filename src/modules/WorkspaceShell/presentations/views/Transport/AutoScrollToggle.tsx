import { type ReactElement } from 'react';

import { ChevronsRight } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { timelineViewStore } from '#/modules/Arrangement/stores';
import { toggleTimelineAutoScroll } from '#/modules/Arrangement/useCases';

export const AutoScrollToggle = (): ReactElement => {
    const timelineViewState = useStore(timelineViewStore, {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    });
    const autoScrollEnabled = timelineViewState.autoScrollEnabled;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant={autoScrollEnabled ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    aria-label="Auto-scroll follows playhead"
                    aria-pressed={autoScrollEnabled ? 'true' : 'false'}
                    onClick={() => {
                        toggleTimelineAutoScroll();
                    }}
                    data-testid="transport-auto-scroll"
                >
                    <ChevronsRight className="size-3.5" aria-hidden="true" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>Auto-scroll {autoScrollEnabled ? 'on' : 'off'}</TooltipContent>
        </Tooltip>
    );
};
