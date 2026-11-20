import { type ReactElement, useEffect, useRef, useState } from 'react';

export function FitRendererWidth({
    maxWidth,
    children,
}: {
    maxWidth: number;
    children: (width: number) => ReactElement;
}): ReactElement {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(maxWidth);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) {
            return undefined;
        }

        // The canvas editors convert pointer coordinates in bitmap pixels.
        // Keep their rendered size and drawing width in the same coordinate space.
        const observer = new ResizeObserver(([entry]) => {
            const nextWidth = Math.floor(entry?.contentRect.width ?? 0);
            if (nextWidth > 0) {
                setWidth(nextWidth);
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={containerRef} className="w-full min-w-0" style={{ maxWidth }}>
            {children(width)}
        </div>
    );
}
