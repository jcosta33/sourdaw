import { type ReactElement } from 'react';

import { Undo2, Redo2 } from 'lucide-react';

import { DawTransportCluster } from '#/components/daw/DawTransportCluster';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { undo, redo } from '#/modules/Command/useCases';

type UndoRedoButtonsProps = {
    canUndo: boolean;
    canRedo: boolean;
};

export const UndoRedoButtons = ({ canUndo, canRedo }: UndoRedoButtonsProps): ReactElement => {
    return (
        <DawTransportCluster className="px-0.5" role="group" aria-label="Undo/Redo">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Undo"
                        disabled={!canUndo}
                        onClick={() => void undo()}
                        data-testid="transport-undo"
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
                        data-testid="transport-redo"
                    >
                        <Redo2 className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Redo (⌘⇧Z)</TooltipContent>
            </Tooltip>
        </DawTransportCluster>
    );
};
