import { type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement, useEffect, useRef } from 'react';

import { cn } from '#/utils/Styles/cn';

export type DragResizeHandleProps = {
    side?: 'left' | 'right' | 'top' | 'bottom';
    direction?: 'horizontal' | 'vertical';
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
    className?: string;
    cursor?: string;
    'aria-label'?: string;
    'aria-valuenow'?: number;
    'aria-valuemin'?: number;
    'aria-valuemax'?: number;
    step?: number;
    tabIndex?: number;
    onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
    onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
};

type KeyboardDeltaOptions = {
    key: string;
    vertical: boolean;
    effectiveSide: 'left' | 'right' | 'top' | 'bottom';
    step: number;
    ariaValueNow?: number;
    ariaValueMin?: number;
    ariaValueMax?: number;
};

const isVertical = (direction?: 'horizontal' | 'vertical', side?: 'left' | 'right' | 'top' | 'bottom'): boolean => {
    if (direction !== undefined) {
        return direction === 'vertical';
    }
    if (side === undefined) {
        return true;
    }
    return side === 'left' || side === 'right';
};

const computeKeyboardDelta = ({
    key,
    vertical,
    effectiveSide,
    step,
    ariaValueNow,
    ariaValueMin,
    ariaValueMax,
}: KeyboardDeltaOptions): number | null => {
    let delta: number | null = null;

    if (vertical) {
        if (key === 'ArrowRight') {
            delta = step;
        } else if (key === 'ArrowLeft') {
            delta = -step;
        }
    } else {
        if (key === 'ArrowDown') {
            delta = step;
        } else if (key === 'ArrowUp') {
            delta = -step;
        }
    }

    if (delta !== null) {
        return effectiveSide === 'left' || effectiveSide === 'top' ? -delta : delta;
    }

    if (key === 'Home' && ariaValueMin !== undefined && ariaValueNow !== undefined) {
        return ariaValueMin - ariaValueNow;
    }

    if (key === 'End' && ariaValueMax !== undefined && ariaValueNow !== undefined) {
        return ariaValueMax - ariaValueNow;
    }

    return null;
};

const releaseCapturedPointer = (captured: { element: HTMLElement; pointerId: number } | null): void => {
    if (!captured) {
        return;
    }
    const { element, pointerId } = captured;
    try {
        if (typeof element.hasPointerCapture === 'function') {
            if (element.hasPointerCapture(pointerId)) {
                element.releasePointerCapture(pointerId);
            }
        } else if (typeof element.releasePointerCapture === 'function') {
            element.releasePointerCapture(pointerId);
        }
    } catch {
        // ignore
    }
};

const attachDocumentListeners = (
    onMove: (event: globalThis.MouseEvent | globalThis.PointerEvent) => void,
    onEnd: () => void
): void => {
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
};

const detachDocumentListeners = (
    onMove: (event: globalThis.MouseEvent | globalThis.PointerEvent) => void,
    onEnd: () => void
): void => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
};

const capturePointer = (
    targetElement?: HTMLElement,
    pointerId?: number
): { element: HTMLElement; pointerId: number } | null => {
    if (targetElement && pointerId !== undefined && typeof targetElement.setPointerCapture === 'function') {
        try {
            targetElement.setPointerCapture(pointerId);
            return { element: targetElement, pointerId };
        } catch {
            return null;
        }
    }
    return null;
};

const setBodyDragStyles = (cursor: string): void => {
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
};

const clearBodyDragStyles = (): void => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
};

type UseDragResizeOptions = {
    vertical: boolean;
    effectiveSide: 'left' | 'right' | 'top' | 'bottom';
    cursor?: string;
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
    onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
    onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
};

const useDragResize = ({
    vertical,
    effectiveSide,
    cursor,
    onResize,
    onResizeEnd,
    onMouseDown,
    onPointerDown,
}: UseDragResizeOptions) => {
    const draggingRef = useRef(false);
    const startRef = useRef(0);
    const onResizeRef = useRef(onResize);
    const onResizeEndRef = useRef(onResizeEnd);
    const verticalRef = useRef(vertical);
    const sideRef = useRef(effectiveSide);
    const cursorRef = useRef(cursor);
    const capturedPointerRef = useRef<{ element: HTMLElement; pointerId: number } | null>(null);

    useEffect(() => {
        onResizeRef.current = onResize;
        onResizeEndRef.current = onResizeEnd;
        verticalRef.current = vertical;
        sideRef.current = effectiveSide;
        cursorRef.current = cursor;
    }, [onResize, onResizeEnd, vertical, effectiveSide, cursor]);

    const handleDocumentMoveRef = useRef<(event: globalThis.MouseEvent | globalThis.PointerEvent) => void>(() => {});
    handleDocumentMoveRef.current = (event: globalThis.MouseEvent | globalThis.PointerEvent) => {
        if (!draggingRef.current) {
            return;
        }
        const current = verticalRef.current ? event.clientX : event.clientY;
        const diff = current - startRef.current;
        if (diff === 0) {
            return;
        }
        startRef.current = current;
        const delta = sideRef.current === 'left' || sideRef.current === 'top' ? -diff : diff;
        onResizeRef.current(delta);
    };

    const moveListenerRef = useRef((event: globalThis.MouseEvent | globalThis.PointerEvent) => {
        handleDocumentMoveRef.current(event);
    });

    const endListenerRef = useRef(() => {
        handleDocumentEndRef.current();
    });

    const cleanupDrag = () => {
        if (!draggingRef.current) {
            return;
        }
        draggingRef.current = false;
        detachDocumentListeners(moveListenerRef.current, endListenerRef.current);
        clearBodyDragStyles();

        releaseCapturedPointer(capturedPointerRef.current);
        capturedPointerRef.current = null;
    };

    const handleDocumentEndRef = useRef<() => void>(() => {});
    handleDocumentEndRef.current = () => {
        if (!draggingRef.current) {
            return;
        }
        cleanupDrag();
        onResizeEndRef.current?.();
    };

    useEffect(() => {
        return () => {
            if (draggingRef.current) {
                cleanupDrag();
            }
        };
    }, []);

    const startDrag = (clientX: number, clientY: number, targetElement?: HTMLElement, pointerId?: number): void => {
        draggingRef.current = true;
        startRef.current = verticalRef.current ? clientX : clientY;
        setBodyDragStyles(cursorRef.current ?? (verticalRef.current ? 'col-resize' : 'row-resize'));

        capturedPointerRef.current = capturePointer(targetElement, pointerId);
        attachDocumentListeners(moveListenerRef.current, endListenerRef.current);
    };

    const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
        onMouseDown?.(event);
        if (event.button !== 0 || draggingRef.current) {
            return;
        }
        event.preventDefault();
        startDrag(event.clientX, event.clientY);
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        onPointerDown?.(event);
        if (event.button !== 0 || draggingRef.current) {
            return;
        }
        event.preventDefault();
        startDrag(event.clientX, event.clientY, event.currentTarget, event.pointerId);
    };

    return { handleMouseDown, handlePointerDown };
};

/**
 * A thin bar that can be dragged or navigated via keyboard to resize a neighboring panel.
 * Supports mouse, pointer events with pointer capture, keyboard navigation, and ARIA attributes.
 */
export const DragResizeHandle = ({
    side,
    direction,
    onResize,
    onResizeEnd,
    className,
    cursor,
    'aria-label': ariaLabel,
    'aria-valuenow': ariaValueNow,
    'aria-valuemin': ariaValueMin,
    'aria-valuemax': ariaValueMax,
    step = 10,
    tabIndex = 0,
    onMouseDown,
    onPointerDown,
}: DragResizeHandleProps): ReactElement => {
    const vertical = isVertical(direction, side);
    const effectiveSide = side ?? (vertical ? 'right' : 'bottom');

    const { handleMouseDown, handlePointerDown } = useDragResize({
        vertical,
        effectiveSide,
        cursor,
        onResize,
        onResizeEnd,
        onMouseDown,
        onPointerDown,
    });

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const delta = computeKeyboardDelta({
            key: event.key,
            vertical,
            effectiveSide,
            step,
            ariaValueNow,
            ariaValueMin,
            ariaValueMax,
        });

        if (delta !== null) {
            event.preventDefault();
            onResize(delta);
            onResizeEnd?.();
        }
    };

    return (
        <div
            className={cn(
                'shrink-0 select-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'bg-surface-tray hover:bg-surface-raised active:bg-surface-overlay',
                vertical
                    ? [
                          'w-[5px] cursor-col-resize border-x border-border-hairline',
                          // groove center line
                          'relative after:absolute after:inset-y-2 after:left-1/2 after:-translate-x-1/2 after:w-px after:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02),rgba(0,0,0,0.2))]',
                      ]
                    : [
                          'h-[5px] cursor-row-resize border-y border-border-hairline',
                          // groove center line
                          'relative after:absolute after:inset-x-4 after:top-1/2 after:-translate-y-1/2 after:h-px after:bg-[linear-gradient(90deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02),rgba(0,0,0,0.2))]',
                      ],
                className
            )}
            style={cursor ? { cursor } : undefined}
            role="separator"
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            aria-label={ariaLabel}
            aria-valuenow={ariaValueNow}
            aria-valuemin={ariaValueMin}
            aria-valuemax={ariaValueMax}
            tabIndex={tabIndex ?? 0}
            onKeyDown={handleKeyDown}
            onMouseDown={handleMouseDown}
            onPointerDown={handlePointerDown}
        />
    );
};
