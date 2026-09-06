/**
 * Context menu for automation lane — curve type selection and shape insertion.
 */
import { type ReactElement } from 'react';

import { createPortal } from 'react-dom';

import { DawMenuButton, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { cn } from '#/utils/Styles/cn';

import { type AutomationPoint, type AutomationCurveType } from '../../../models/AutomationViewTypes';
import { CURVE_OPTIONS, SHAPE_OPTIONS } from '../../helpers/automationLaneConstants';

type AutomationShapeType = 'sine' | 'triangle' | 'sawtooth-up' | 'sawtooth-down' | 'square' | 'random';

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
}: AutomationContextMenuProps): ReactElement =>
    createPortal(
        <>
            <div className="fixed inset-0 z-50" onClick={onClose} />
            <div
                className="daw-floating-surface fixed z-50 min-w-[160px] rounded-md py-1"
                style={{
                    left: Math.min(x, window.innerWidth - 200),
                    ...(y > window.innerHeight - 300 ? { bottom: window.innerHeight - y } : { top: y }),
                }}
                role="menu"
            >
                {section !== 'shape' ? (
                    <>
                        <DawMenuSectionLabel className="px-2">Curve Type</DawMenuSectionLabel>
                        {CURVE_OPTIONS.map((opt) => (
                            <DawMenuButton
                                key={opt.value}
                                className={cn(
                                    'justify-start px-3 text-foreground hover:bg-accent/50 hover:text-foreground',
                                    points.find((param) => Math.abs(param.beat - beat) < 0.05)?.curve === opt.value &&
                                        'text-primary font-medium'
                                )}
                                onClick={() => onCurveSelect(opt.value)}
                            >
                                {opt.label}
                            </DawMenuButton>
                        ))}
                        <DawMenuSeparator />
                    </>
                ) : null}
                <DawMenuSectionLabel className="px-2">Insert Shape</DawMenuSectionLabel>
                {SHAPE_OPTIONS.map((opt) => (
                    <DawMenuButton
                        key={opt.value}
                        className="justify-start px-3 text-foreground hover:bg-accent/50 hover:text-foreground"
                        onClick={() => onShapeInsert(opt.value)}
                    >
                        {opt.label}
                    </DawMenuButton>
                ))}
            </div>
        </>,
        document.body
    );
