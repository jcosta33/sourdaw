import { type ReactElement, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { RoutingGraph } from '../RoutingGraph';

export const SignalFlowSection = (): ReactElement => {
    const [expanded, setExpanded] = useState(false);

    return (
        <section>
            <button
                type="button"
                className="flex w-full items-center gap-1 mb-2"
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
                <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Signal Flow</h3>
            </button>
            {expanded && (
                <div className="rounded bg-surface-overlay p-1">
                    <RoutingGraph />
                </div>
            )}
        </section>
    );
};
