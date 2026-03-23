import { type ReactElement, type MouseEvent } from 'react';
import { setTrackHeight } from '#/modules/Track/useCases/toggleTrackState';

type ResizeHandleProps = {
    trackId: string;
};

export const ResizeHandle = ({ trackId }: ResizeHandleProps): ReactElement => {
    const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const startY = e.clientY;
        const row = (e.currentTarget as HTMLElement).parentElement;
        const startHeight = row?.getBoundingClientRect().height ?? 64;

        const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
            const delta = moveEvent.clientY - startY;
            setTrackHeight(trackId, Math.round(startHeight + delta));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
        };

        document.body.style.cursor = 'ns-resize';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    return (
        <div
            className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize opacity-0 hover:opacity-100 hover:bg-ring/40 transition-opacity"
            onMouseDown={handleMouseDown}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize track height"
        />
    );
};
