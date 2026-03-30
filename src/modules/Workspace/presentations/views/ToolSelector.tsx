import { type ReactElement } from 'react';
import { MousePointer2, Scissors, Pencil, TrendingUp, MoveHorizontal } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { setEditingTool } from '../../useCases/setEditingTool';
import { TOOL_LABELS, type EditingTool } from '../../models/EditingTool';

const TOOL_ICONS: Record<EditingTool, ReactElement> = {
    select: <MousePointer2 className="size-3.5" aria-hidden="true" />,
    cut: <Scissors className="size-3.5" aria-hidden="true" />,
    draw: <Pencil className="size-3.5" aria-hidden="true" />,
    automation: <TrendingUp className="size-3.5" aria-hidden="true" />,
    stretch: <MoveHorizontal className="size-3.5" aria-hidden="true" />,
};

const TOOLS: EditingTool[] = ['select', 'cut', 'draw', 'automation', 'stretch'];

type ToolSelectorProps = {
    rippleEditing?: boolean;
    onToggleRipple?: () => void;
};

export const ToolSelector = ({ rippleEditing, onToggleRipple }: ToolSelectorProps): ReactElement => {
    const { activeTool } = useWorkspaceState();

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
            aria-label="Editing tools"
        >
            {TOOLS.map((tool) => (
                <Tooltip key={tool}>
                    <TooltipTrigger asChild>
                        <Button
                            variant={activeTool === tool ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            role="radio"
                            aria-checked={activeTool === tool}
                            aria-label={TOOL_LABELS[tool]}
                            onClick={() => setEditingTool(tool)}
                        >
                            {TOOL_ICONS[tool]}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{TOOL_LABELS[tool]}</TooltipContent>
                </Tooltip>
            ))}
            {onToggleRipple != null ? (
                <>
                    <div className="w-px h-4 mx-0.5" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.15) 100%)' }} />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant={rippleEditing ? 'secondary' : 'ghost'}
                                size="xs"
                                onClick={onToggleRipple}
                                className={rippleEditing ? 'text-[var(--color-accent-peach)] border-[var(--color-accent-peach)]/30 px-1.5' : 'px-1.5'}
                                aria-pressed={rippleEditing}
                                aria-label="Toggle ripple editing"
                            >
                                <span className="text-[10px] font-bold">R</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Ripple Editing (auto-shift clips on delete)</TooltipContent>
                    </Tooltip>
                </>
            ) : null}
        </div>
    );
};
