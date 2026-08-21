import { type ReactElement, type ReactNode } from 'react';

import { X } from 'lucide-react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { DragResizeHandle } from '#/components/ui/DragResizeHandle';

type InstrumentBottomPanelProps = {
    label: string;
    /** Tailwind text color class for the label, e.g. "text-[var(--color-accent-lavender)]" */
    labelColor: string;
    /** Tailwind border color class for the top border, e.g. "border-[var(--color-accent-lavender)]/20" */
    borderColor: string;
    height: number;
    onResize: (setter: (prev: number) => number) => void;
    onClose: () => void;
    children: ReactNode;
};

export const InstrumentBottomPanel = ({
    label,
    labelColor,
    borderColor,
    height,
    onResize,
    onClose,
    children,
}: InstrumentBottomPanelProps): ReactElement => (
    <>
        <DragResizeHandle side="top" onResize={(data) => onResize((h) => Math.max(160, h + data))} />
        <div
            className={`contain-strict flex flex-col bg-surface-base border-t ${borderColor} overflow-hidden shrink-0 animate-in slide-in-from-bottom-2 duration-200`}
            style={{ height }}
        >
            <Row justify="between" shrink={false} className="px-3 py-1 border-b border-border/30 bg-surface-app/50">
                <span className={`text-[10px] font-bold ${labelColor} uppercase tracking-wider`}>{label}</span>
                <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label={`Close ${label}`}>
                    <X className="size-3.5" />
                </Button>
            </Row>
            {children}
        </div>
    </>
);
