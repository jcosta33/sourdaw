import { type ReactElement } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { undo, redo } from '#/modules/Command/useCases/undoRedo';

type UndoRedoButtonsProps = {
    canUndo: boolean;
    canRedo: boolean;
};

export const UndoRedoButtons = ({ canUndo, canRedo }: UndoRedoButtonsProps): ReactElement => {
    return (
        <div
            className="flex items-center gap-0.5 px-0.5 py-0.5 rounded-sm"
            style={{
                background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                border: '1px solid rgba(0,0,0,0.4)',
                borderBottom: '1px solid rgba(40,40,40,0.3)',
            }}
            role="group"
            aria-label="Undo/Redo"
        >
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Undo"
                        disabled={!canUndo}
                        onClick={() => void undo()}
                    >
                        <Undo2 className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Undo (⌘Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Redo"
                        disabled={!canRedo}
                        onClick={() => void redo()}
                    >
                        <Redo2 className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Redo (⌘⇧Z)</TooltipContent>
            </Tooltip>
        </div>
    );
};
