import {
    type Dispatch,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactElement,
    type ReactNode,
    type SetStateAction,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

import { GripHorizontal, X } from 'lucide-react';

import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { DragResizeHandle } from '#/components/ui/DragResizeHandle';
import { clamp } from '#/utils/Math/clamp';
import { isDragGestureActive, isPlainEscapePress } from '#/utils/UI/activeDragGesture';

type Size = { width: number; height: number };
export type DevicePanelGeometry = Size & { left: number; top: number };

const DEFAULT_SIZE: Size = { width: 1200, height: 760 };
const MIN_SIZE: Size = { width: 320, height: 160 };

function fitGeometry(preferred: DevicePanelGeometry | null, area: Size): DevicePanelGeometry {
    const width = Math.min((preferred ?? DEFAULT_SIZE).width, area.width);
    const height = Math.min((preferred ?? DEFAULT_SIZE).height, area.height);
    const slackX = area.width - width;
    const slackY = area.height - height;
    return {
        width,
        height,
        left: clamp(preferred?.left ?? slackX / 2, 0, slackX),
        top: clamp(preferred?.top ?? slackY / 2, 0, slackY),
    };
}

type FloatingDevicePanelProps = {
    label: string;
    labelColor: string;
    borderColor: string;
    geometry: DevicePanelGeometry | null;
    setGeometry: Dispatch<SetStateAction<DevicePanelGeometry | null>>;
    otherSurfaceOwnsEscape: (dialog: Element | null, target: EventTarget | null) => boolean;
    onClose: () => void;
    children: ReactNode;
};

function useDevicePanelFocus(
    onClose: () => void,
    otherSurfaceOwnsEscape: FloatingDevicePanelProps['otherSurfaceOwnsEscape']
) {
    const dialog = useRef<HTMLDivElement>(null);
    const opener = useRef<HTMLElement | null>(null);

    function restoreFocus(): void {
        const trigger = opener.current;
        if (trigger?.isConnected) {
            trigger.focus({ preventScroll: true });
            if (document.activeElement === trigger) {
                return;
            }
        }
        document.getElementById('main-content')?.focus({ preventScroll: true });
    }

    useLayoutEffect(() => {
        const focused = document.activeElement;
        opener.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
        const panel = dialog.current;
        panel?.focus({ preventScroll: true });
        return () => {
            // On replacement, an outside control may already own focus and be the new opener.
            if (panel?.contains(document.activeElement) || document.activeElement === document.body) {
                restoreFocus();
            }
        };
    }, []);

    function dismiss(): void {
        restoreFocus();
        onClose();
    }

    useEffect(() => {
        // Remember the Escape owner before a nested control closes or removes its portal.
        // Honor its own preventDefault/stopPropagation before dismissing at document bubble.
        let eligible: KeyboardEvent | null = null;
        const classify = (event: KeyboardEvent): void => {
            eligible = null;
            if (
                !isPlainEscapePress(event) ||
                isDragGestureActive() ||
                otherSurfaceOwnsEscape(dialog.current, event.target)
            ) {
                return;
            }
            eligible = event;
        };
        const close = (event: KeyboardEvent): void => {
            if (event === eligible && !event.defaultPrevented) {
                event.preventDefault();
                event.stopPropagation();
                restoreFocus();
                onClose();
            }
        };
        window.addEventListener('keydown', classify, true);
        document.addEventListener('keydown', close);
        return () => {
            window.removeEventListener('keydown', classify, true);
            document.removeEventListener('keydown', close);
        };
    }, [onClose, otherSurfaceOwnsEscape]);

    return { dialog, dismiss };
}

function useTitleMovement(
    bounds: DevicePanelGeometry,
    area: Size,
    setGeometry: FloatingDevicePanelProps['setGeometry']
) {
    const drag = useRef<{ id: number; x: number; y: number; start: DevicePanelGeometry } | null>(null);

    function startMove(event: ReactPointerEvent<HTMLButtonElement>): void {
        if (event.button !== 0 || drag.current !== null) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: bounds };
    }

    function move(event: ReactPointerEvent<HTMLButtonElement>): void {
        const gesture = drag.current;
        if (!gesture || gesture.id !== event.pointerId) {
            return;
        }
        setGeometry(
            fitGeometry(
                {
                    ...gesture.start,
                    left: gesture.start.left + event.clientX - gesture.x,
                    top: gesture.start.top + event.clientY - gesture.y,
                },
                area
            )
        );
    }

    function endMove(event: ReactPointerEvent<HTMLButtonElement>): void {
        if (drag.current?.id === event.pointerId) {
            drag.current = null;
        }
    }

    function moveByKey(event: ReactKeyboardEvent<HTMLButtonElement>): void {
        const directions: Record<string, readonly [number, number]> = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10],
        };
        const step = directions[event.key];
        if (!step) {
            return;
        }
        event.preventDefault();
        setGeometry(fitGeometry({ ...bounds, left: bounds.left + step[0], top: bounds.top + step[1] }, area));
    }

    return {
        onPointerDown: startMove,
        onPointerMove: move,
        onPointerUp: endMove,
        onPointerCancel: endMove,
        onLostPointerCapture: endMove,
        onKeyDown: moveByKey,
    };
}

export function FloatingDevicePanel({
    label,
    labelColor,
    borderColor,
    geometry,
    setGeometry,
    otherSurfaceOwnsEscape,
    onClose,
    children,
}: FloatingDevicePanelProps): ReactElement {
    const titleId = useId();
    const workspace = useRef<HTMLDivElement>(null);
    const [area, setArea] = useState<Size>({ width: 0, height: 0 });
    const bounds = fitGeometry(geometry, area);

    useLayoutEffect(() => {
        const element = workspace.current;
        if (!element) {
            return;
        }
        const measure = (): void => setArea({ width: element.clientWidth, height: element.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const { dialog, dismiss } = useDevicePanelFocus(onClose, otherSurfaceOwnsEscape);
    const titleMovement = useTitleMovement(bounds, area, setGeometry);

    function resize(axis: keyof Size, delta: number): void {
        setGeometry((previous) => {
            const fitted = fitGeometry(previous, area);
            const origin = axis === 'width' ? fitted.left : fitted.top;
            const maximum = area[axis] - origin;
            return { ...fitted, [axis]: clamp(fitted[axis] + delta, Math.min(MIN_SIZE[axis], maximum), maximum) };
        });
    }

    return (
        <div ref={workspace} className="pointer-events-none absolute inset-[16px] z-30">
            <DawUtilityPanel
                ref={dialog}
                role="dialog"
                aria-modal="false"
                data-device-editor=""
                aria-labelledby={titleId}
                tabIndex={-1}
                style={bounds}
                className={`pointer-events-auto absolute isolate focus:outline-none ${borderColor}`}
            >
                <Row shrink={false} className="relative z-10 gap-1 border-b border-border/30 bg-surface-app pl-2 pr-1">
                    <button
                        type="button"
                        aria-label={`Move ${label} panel`}
                        title="Drag or use arrow keys to move"
                        className="flex min-w-0 flex-1 cursor-move touch-none select-none items-center gap-2 py-1.5 text-left"
                        {...titleMovement}
                    >
                        <GripHorizontal aria-hidden="true" className="size-3.5 text-muted-foreground" />
                        <span
                            id={titleId}
                            className={`truncate text-xs font-bold uppercase tracking-wider ${labelColor}`}
                        >
                            {label}
                        </span>
                    </button>
                    <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label={`Close ${label}`}>
                        <X className="size-3.5" />
                    </Button>
                </Row>
                <div
                    data-testid="floating-device-panel-body"
                    className="relative isolate min-h-0 flex-1 overflow-auto overscroll-contain mr-[5px]"
                >
                    {children}
                </div>
                <DragResizeHandle
                    side="right"
                    className="absolute inset-y-8 right-0 touch-none"
                    aria-label={`Resize ${label} width`}
                    aria-valuemin={Math.min(MIN_SIZE.width, area.width - bounds.left)}
                    aria-valuenow={bounds.width}
                    aria-valuemax={area.width - bounds.left}
                    onResize={(delta) => resize('width', delta)}
                />
                <DragResizeHandle
                    side="bottom"
                    className="touch-none"
                    aria-label={`Resize ${label} height`}
                    aria-valuemin={Math.min(MIN_SIZE.height, area.height - bounds.top)}
                    aria-valuenow={bounds.height}
                    aria-valuemax={area.height - bounds.top}
                    onResize={(delta) => resize('height', delta)}
                />
            </DawUtilityPanel>
        </div>
    );
}
