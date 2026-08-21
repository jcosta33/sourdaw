import { type ReactElement, useState } from 'react';

import { ChevronRight, ChevronDown } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Button } from '#/components/ui/button';
import { RoutingGraph } from '#/modules/Routing/presentations/views';

import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

export const SignalFlowSection = (): ReactElement => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm">
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    className="flex w-full items-center gap-1"
                    onClick={() => {
                        setExpanded(!expanded);
                    }}
                    aria-expanded={expanded}
                >
                    {expanded ? (
                        <ChevronDown className="size-3 text-muted-foreground" />
                    ) : (
                        <ChevronRight className="size-3 text-muted-foreground" />
                    )}
                    <span
                        className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
                        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
                    >
                        Signal Flow
                    </span>
                </Button>
            </DawHeaderBand>
            {expanded ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    <SurfaceCard>
                        <div className="rounded bg-surface-overlay p-1">
                            <RoutingGraph />
                        </div>
                    </SurfaceCard>
                </div>
            ) : null}
        </div>
    );
};
