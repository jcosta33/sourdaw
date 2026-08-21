/**
 * Lane control buttons — virgin territory toggle, Y-zoom, visibility, close.
 */
import { type ReactElement } from 'react';

import { Eye, EyeOff, X, Maximize2 } from 'lucide-react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

type AutomationLaneControlsProps = {
    isVisible: boolean;
    selectedCount: number;
    onZoomToUsedRange: () => void;
    onToggleVisibility: () => void;
    onClose: () => void;
};

export const AutomationLaneControls = ({
    isVisible,
    selectedCount,
    onZoomToUsedRange,
    onToggleVisibility,
    onClose,
}: AutomationLaneControlsProps): ReactElement => (
    <Row gap={0.5} className="absolute top-1 right-2 z-10">
        {selectedCount > 0 ? <span className="text-[8px] text-muted-foreground mr-1">{selectedCount} sel</span> : null}
        <Button
            variant="bare"
            size="bare"
            type="button"
            className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
            onClick={onZoomToUsedRange}
            aria-label="Zoom to used range"
            title="Zoom Y to used range"
        >
            <Maximize2 className="size-3" />
        </Button>
        <Button
            variant="bare"
            size="bare"
            type="button"
            className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
            onClick={onToggleVisibility}
            aria-label={isVisible ? 'Hide lane' : 'Show lane'}
        >
            {isVisible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </Button>
        <Button
            variant="bare"
            size="bare"
            type="button"
            className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
            onClick={onClose}
            aria-label="Close lane"
        >
            <X className="size-3" />
        </Button>
    </Row>
);
