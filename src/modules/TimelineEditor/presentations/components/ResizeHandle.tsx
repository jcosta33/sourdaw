import { type ReactElement } from 'react';

import { DragResizeHandle } from '#/components/ui/DragResizeHandle';

type ResizeHandleProps = {
    direction: 'horizontal' | 'vertical';
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
};

export const ResizeHandle = ({ direction, onResize, onResizeEnd }: ResizeHandleProps): ReactElement => (
    <DragResizeHandle direction={direction} onResize={onResize} onResizeEnd={onResizeEnd} />
);
