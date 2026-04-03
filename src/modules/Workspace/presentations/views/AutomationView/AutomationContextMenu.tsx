/**
 * Context menu for automation lane — curve type selection and shape insertion.
 */
import { type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '#/helpers/Styles/cn';
import { type AutomationPoint, type AutomationCurveType } from '#/modules/Automation/useCases/automation/types';
import { type AutomationShapeType } from '#/modules/Automation/useCases/automationShapes';
import { FloatingMenuSectionLabel, FloatingMenuSeparator } from '../../components/FloatingMenuParts';
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
}: AutomationContextMenuProps): ReactElement => createPortal(
    <>
        <div className="fixed inset-0 z-50" onClick={onClose} />
        <div
            className="daw-floating-surface fixed z-50 min-w-[160px] rounded-md py-1"
            style={{
                left: Math.min(x, window.innerWidth - 200),
                ...(y > window.innerHeight - 300 ? { bottom: window.innerHeight - y } : { top: y }),
            }}
        >
            {section !== 'shape' ? (
                <>
                    <FloatingMenuSectionLabel className="px-2">Curve Type</FloatingMenuSectionLabel>
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
                    <FloatingMenuSeparator />
                </>
            ) : null}
            <FloatingMenuSectionLabel className="px-2">Insert Shape</FloatingMenuSectionLabel>
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
    </>,
    document.body
);
