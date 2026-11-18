/**
 * Context menu for automation lane — curve type selection and shape insertion.
 */
import { type ReactElement, useRef } from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { cn } from '#/utils/Styles/cn';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

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
}: AutomationContextMenuProps): ReactElement => {
    const menuRef = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(menuRef, onClose);

    return (
        <DawContextMenuSurface
            ref={menuRef}
            x={x}
            y={y}
            xClampOffset={200}
            yClampOffset={300}
            backdrop
            onClose={onClose}
            className="min-w-[160px]"
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
                    leadingContent={
                        <span aria-hidden="true" className="w-4 shrink-0 text-center">
                            {opt.glyph}
                        </span>
                    }
                    onClick={() => onShapeInsert(opt.value)}
                >
                    {opt.label}
                </DawMenuButton>
            ))}
        </DawContextMenuSurface>
    );
};
