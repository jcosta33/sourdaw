import { type ReactElement } from "react";
import { MousePointer2, Scissors, Pencil, TrendingUp, MoveHorizontal } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";
import { useWorkspaceState } from "../hooks/useWorkspaceState";
import { setEditingTool } from "../../useCases/setEditingTool";
import { TOOL_LABELS, type EditingTool } from "../../models/EditingTool";

const TOOL_ICONS: Record<EditingTool, ReactElement> = {
    select: <MousePointer2 className="size-3.5" aria-hidden="true" />,
    cut: <Scissors className="size-3.5" aria-hidden="true" />,
    draw: <Pencil className="size-3.5" aria-hidden="true" />,
    automation: <TrendingUp className="size-3.5" aria-hidden="true" />,
    stretch: <MoveHorizontal className="size-3.5" aria-hidden="true" />,
};

const TOOLS: EditingTool[] = ["select", "cut", "draw", "automation", "stretch"];

export const ToolSelector = (): ReactElement => {
    const { activeTool } = useWorkspaceState();

    return (
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Editing tools">
            {TOOLS.map((tool) => (
                <Tooltip key={tool}>
                    <TooltipTrigger asChild>
                        <Button
                            variant={activeTool === tool ? "secondary" : "ghost"}
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
        </div>
    );
};
