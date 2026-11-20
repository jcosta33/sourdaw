export function startVisiblePianoFrameLoop(canvas: HTMLCanvasElement, draw: () => void): () => void {
    let rafId: number | null = null;
    let intersecting = false;
    let disposed = false;

    const render = (): void => {
        rafId = null;
        draw();
        rafId = requestAnimationFrame(render);
    };
    const updateRendering = (): void => {
        if (disposed) {
            return;
        }
        if (intersecting && document.visibilityState === 'visible') {
            if (rafId === null) {
                rafId = requestAnimationFrame(render);
            }
        } else if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    };
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.target === canvas) {
                intersecting = entry.isIntersecting;
            }
        }
        updateRendering();
    });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', updateRendering);
    return () => {
        disposed = true;
        observer.disconnect();
        document.removeEventListener('visibilitychange', updateRendering);
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
        }
    };
}
