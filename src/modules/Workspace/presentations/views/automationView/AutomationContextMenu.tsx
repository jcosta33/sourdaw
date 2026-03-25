/**
 * Context menu for automation lane — curve type selection and shape insertion.
 */
import { type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { type AutomationPoint, type AutomationCurveType } from '#/modules/Arrangement/useCases/trackQueries';
import { type AutomationShapeType } from '#/modules/Automation/useCases/automationShapes';
import { CURVE_OPTIONS, SHAPE_OPTIONS } from '../../helpers/automationLaneConstants';

type AutomationContextMenuProps = {
    x: number;
    y: number;
    beat: number;
    section: 'curve' | 'shape' | null;
    points: AutomationPoint[];
    onCurveSelect: (curve: AutomationCurveType) => void;
    onShapeInsert: (shape: AutomationShapeType) => void;
    onClose: () => void;
};

export const AutomationContextMenu = ({
    x,
    y,
    beat,
    section,
    points,
    onCurveSelect,
    onShapeInsert,
    onClose,
}: AutomationContextMenuProps): ReactElement => (
    <>
        <div className="fixed inset-0 z-50" onClick={onClose} />
        <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-xl py-1 min-w-[160px]"
            style={{
                left: x,
                ...(y > window.innerHeight - 300 ? { bottom: window.innerHeight - y } : { top: y }),
            }}
        >
            {section !== 'shape' ? (
                <>
                    <div className="px-2 py-1 text-[9px] text-muted-foreground uppercase tracking-wider">
                        Curve Type
                    </div>
                    {CURVE_OPTIONS.map((opt) => (
                        <button
                            type="button"
                            key={opt.value}
                            className={cn(
                                'w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors',
                                points.find((p) => Math.abs(p.beat - beat) < 0.05)?.curve === opt.value &&
                                    'text-primary font-medium'
                            )}
                            onClick={() => onCurveSelect(opt.value)}
                        >
                            {opt.label}
                        </button>
                    ))}
                    <div className="mx-2 my-1 border-t border-border/30" />
                </>
            ) : null}
            <div className="px-2 py-1 text-[9px] text-muted-foreground uppercase tracking-wider">Insert Shape</div>
            {SHAPE_OPTIONS.map((opt) => (
                <button
                    type="button"
                    key={opt.value}
                    className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                    onClick={() => onShapeInsert(opt.value)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    </>
);
