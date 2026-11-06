import { type ReactElement } from 'react';

import { DragResizeHandle } from '#/components/ui/DragResizeHandle';

type ResizeHandleProps = {
    direction: 'horizontal' | 'vertical';
    label: string;
    valueNow: number;
    valueMin: number;
    valueMax: number;
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
};

export const ResizeHandle = ({
    direction,
    label,
    valueNow,
    valueMin,
    valueMax,
    onResize,
    onResizeEnd,
}: ResizeHandleProps): ReactElement => (
    <DragResizeHandle
        direction={direction}
        aria-label={label}
        aria-valuenow={Math.round(valueNow)}
        aria-valuemin={valueMin}
        aria-valuemax={valueMax}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
    />
);
