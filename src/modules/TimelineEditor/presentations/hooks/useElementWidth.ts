import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * Tracks an element's content width through ResizeObserver. Returns `fallbackWidth`
 * until the element reports a measurable width, so canvases still draw on first paint.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallbackWidth: number): number {
    const [width, setWidth] = useState(fallbackWidth);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return undefined;
        }
        const observer = new ResizeObserver(([entry]) => {
            const measured = entry ? Math.floor(entry.contentRect.width) : 0;
            if (measured > 0) {
                setWidth(measured);
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return width;
}
