import { type ReactElement, useState } from 'react';
import { Card } from '#/components/ui/card';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { RoutingGraph } from '../RoutingGraph';

export const SignalFlowSection = (): ReactElement => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div>
            <div
                className="px-2 py-1.5 mb-2 rounded-sm"
                style={{
                    background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.03)',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    borderBottom: '1px solid rgba(0,0,0,0.4)',
                }}
            >
                <button
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
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                        Signal Flow
                    </span>
                </button>
            </div>
            {expanded ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2">
                        <div className="rounded bg-surface-overlay p-1">
                            <RoutingGraph />
                        </div>
                    </Card>
                </div>
            ) : null}
        </div>
    );
};
