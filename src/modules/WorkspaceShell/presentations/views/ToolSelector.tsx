import { type ReactElement } from 'react';

import { MousePointer2, Scissors, Pencil, TrendingUp, MoveHorizontal, SquareDashed } from 'lucide-react';

import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

import { TOOL_LABELS, type EditingTool } from '../../models/EditingTool';
import { setEditingTool } from '../../useCases/setEditingTool';
import { useWorkspaceState } from '../hooks/useWorkspaceState';

const TOOL_ICONS: Record<EditingTool, ReactElement> = {
    select: <MousePointer2 className="size-3.5" aria-hidden="true" />,
    cut: <Scissors className="size-3.5" aria-hidden="true" />,
    draw: <Pencil className="size-3.5" aria-hidden="true" />,
    automation: <TrendingUp className="size-3.5" aria-hidden="true" />,
    stretch: <MoveHorizontal className="size-3.5" aria-hidden="true" />,
    marquee: <SquareDashed className="size-3.5" aria-hidden="true" />,
};

const TOOLS: EditingTool[] = ['select', 'cut', 'draw', 'automation', 'stretch', 'marquee'];

type ToolSelectorProps = {
    rippleEditing?: boolean;
    onToggleRipple?: () => void;
};

export const ToolSelector = ({ rippleEditing, onToggleRipple }: ToolSelectorProps): ReactElement => {
    const { activeTool } = useWorkspaceState();

    return (
        <DawControlStrip className="gap-0.5 rounded-sm px-1 py-0.5" role="radiogroup" aria-label="Editing tools">
            {TOOLS.map((tool) => (
                <Tooltip key={tool}>
                    <TooltipTrigger asChild>
                        <Button
                            variant={activeTool === tool ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            role="radio"
                            aria-checked={activeTool === tool}
                            aria-label={TOOL_LABELS[tool]}
                            data-testid={`tool-${tool}`}
                            onClick={() => setEditingTool(tool)}
                        >
                            {TOOL_ICONS[tool]}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{TOOL_LABELS[tool]}</TooltipContent>
                </Tooltip>
            ))}
            {onToggleRipple !== null && onToggleRipple !== undefined ? (
                <>
                    <div className="mx-0.5 h-4 w-px daw-seam" />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant={rippleEditing ? 'secondary' : 'ghost'}
                                size="xs"
                                onClick={onToggleRipple}
                                data-testid="tool-ripple"
                                className={
                                    rippleEditing
                                        ? 'text-[var(--color-accent-peach)] border-[var(--color-accent-peach)]/30 px-1.5'
                                        : 'px-1.5'
                                }
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
        </DawControlStrip>
    );
};
