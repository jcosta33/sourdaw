type FrameCallback = (time: DOMHighResTimeStamp, delta: number) => void;

class AnimationScheduler {
    private callbacks = new Map<string, FrameCallback>();
    private rafId: number | null = null;
    private lastTime = 0;

    public register(id: string, cb: FrameCallback): void {
        this.callbacks.set(id, cb);
        if (this.rafId === null && this.callbacks.size > 0) {
            this.start();
        }
    }

    public unregister(id: string): void {
        this.callbacks.delete(id);
        if (this.callbacks.size === 0) {
            this.stop();
        }
    }

    private start(): void {
        this.lastTime = performance.now();
        const tick = (time: DOMHighResTimeStamp) => {
            const delta = time - this.lastTime;
            this.lastTime = time;
            
            for (const [id, cb] of this.callbacks.entries()) {
                try {
                    cb(time, delta);
                } catch (e) {
                    console.error(`[AnimationScheduler] Callback "${id}" threw:`, e);
                }
            }
            
            if (this.callbacks.size > 0) {
                this.rafId = requestAnimationFrame(tick);
            } else {
                this.rafId = null;
            }
        };
        this.rafId = requestAnimationFrame(tick);
    }

    private stop(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
}

export const animationScheduler = new AnimationScheduler();
