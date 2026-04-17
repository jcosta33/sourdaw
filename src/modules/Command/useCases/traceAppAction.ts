// §11 — Action-dispatch trace ring buffer (dev-only).
//
// Every `executeAppAction` call pushes a `{ type, source, timestamp }` entry into
// a bounded ring exposed on `window.__sourdaw_trace__` when running under Vite
// dev. The ring is capped so long sessions cannot leak memory.
//
// Use from the browser devtools:
//
//   > __sourdaw_trace__.entries()
//   > __sourdaw_trace__.clear()
//
// This is a triage primitive: when a shortcut seems to double-fire or a panel
// fails to respond to an action, the ring shows the exact dispatch sequence
// (and the source: manual | shortcut | voice | ai). Intentionally kept dev-only
// so no production-path cost is incurred.

const RING_CAPACITY = 128;

type TraceEntry = {
    type: string;
    source: string;
    timestamp: number;
};

type TraceRing = {
    push(entry: TraceEntry): void;
    entries(): TraceEntry[];
    clear(): void;
};

function createTraceRing(): TraceRing {
    const buffer: (TraceEntry | undefined)[] = new Array<TraceEntry | undefined>(RING_CAPACITY);
    let writeIndex = 0;
    let count = 0;

    return {
        push(entry: TraceEntry): void {
            buffer[writeIndex] = entry;
            writeIndex = (writeIndex + 1) % RING_CAPACITY;
            if (count < RING_CAPACITY) {
                count += 1;
            }
        },

        entries(): TraceEntry[] {
            const ordered: TraceEntry[] = [];
            const start = count < RING_CAPACITY ? 0 : writeIndex;
            for (let step = 0; step < count; step += 1) {
                const entry = buffer[(start + step) % RING_CAPACITY];
                if (entry !== undefined) {
                    ordered.push(entry);
                }
            }
            return ordered;
        },

        clear(): void {
            for (let index = 0; index < RING_CAPACITY; index += 1) {
                buffer[index] = undefined;
            }
            writeIndex = 0;
            count = 0;
        },
    };
}

type SourdawGlobals = {
    __sourdaw_trace__?: TraceRing;
};

function getRing(): TraceRing | null {
    if (!import.meta.env.DEV) {
        return null;
    }
    if (typeof window === 'undefined') {
        return null;
    }
    const globals = window as typeof window & SourdawGlobals;
    let ring = globals.__sourdaw_trace__;
    if (ring === undefined) {
        ring = createTraceRing();
        globals.__sourdaw_trace__ = ring;
    }
    return ring;
}

export function traceAppAction(type: string, source: string): void {
    const ring = getRing();
    if (ring === null) {
        return;
    }
    ring.push({ type, source, timestamp: Date.now() });
}
