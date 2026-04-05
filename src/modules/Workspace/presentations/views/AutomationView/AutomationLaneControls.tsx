/**
 * Lane control buttons — virgin territory toggle, Y-zoom, visibility, close.
 */
import { type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { Eye, EyeOff, X, Maximize2 } from 'lucide-react';

type AutomationLaneControlsProps = {
    laneId: string;
    isVirginTerritory: boolean;
    isVisible: boolean;
    selectedCount: number;
    onToggleVirginTerritory: () => void;
    onZoomToUsedRange: () => void;
    onToggleVisibility: () => void;
    onClose: () => void;
};

export const AutomationLaneControls = ({
    isVirginTerritory,
    isVisible,
    selectedCount,
    onToggleVirginTerritory,
    onZoomToUsedRange,
    onToggleVisibility,
    onClose,
}: AutomationLaneControlsProps): ReactElement => (
    <div className="absolute top-1 right-2 z-10 flex items-center gap-0.5">
        {selectedCount > 0 ? <span className="text-[8px] text-muted-foreground mr-1">{selectedCount} sel</span> : null}
        <button
            type="button"
            className={cn(
                'size-5 flex items-center justify-center rounded hover:bg-surface-raised/80 transition-colors',
                isVirginTerritory ? 'text-[var(--color-state-success)]' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={onToggleVirginTerritory}
            aria-label={isVirginTerritory ? 'Disable virgin territory' : 'Enable virgin territory'}
            title="Virgin Territory"
        >
            <span className="text-[8px] font-bold">VT</span>
        </button>
        <button
            type="button"
            className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
            onClick={onZoomToUsedRange}
            aria-label="Zoom to used range"
            title="Zoom Y to used range"
        >
            <Maximize2 className="size-3" />
        </button>
        <button
            type="button"
            className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
            onClick={onToggleVisibility}
            aria-label={isVisible ? 'Hide lane' : 'Show lane'}
        >
            {isVisible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </button>
        <button
            type="button"
            className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
            onClick={onClose}
            aria-label="Close lane"
        >
            <X className="size-3" />
        </button>
    </div>
);
