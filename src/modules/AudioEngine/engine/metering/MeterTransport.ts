const METER_SLOTS_PER_POOL = 32;

type MeterSlot = {
    pool: MeterPool;
    slot: number;
};

type MeterPool = {
    node: AudioWorkletNode;
    peaks: Float32Array;
    sources: Array<AudioNode | null>;
};

/**
 * Host-owned peak-meter side taps.
 *
 * Chromium automatically pulls zero-output AudioWorkletNodes, so each pool can
 * observe 32 independent signals without sitting in any audible signal path.
 */
export class MeterTransport {
    private readonly sources = new Map<string, AudioNode>();
    private readonly slots = new Map<string, MeterSlot>();
    private readonly pools: MeterPool[] = [];
    private started = false;
    private disposed = false;

    constructor(private readonly context: AudioContext) {}

    public register(id: string, source: AudioNode): void {
        if (this.disposed) {
            return;
        }
        this.unregister(id);
        this.sources.set(id, source);
        if (this.started) {
            try {
                this.attach(id, source);
            } catch (error) {
                this.sources.delete(id);
                throw error;
            }
        }
    }

    public unregister(id: string): void {
        this.detach(id);
        this.sources.delete(id);
    }

    private detach(id: string): void {
        const source = this.sources.get(id);
        const meterSlot = this.slots.get(id);
        if (source && meterSlot) {
            try {
                source.disconnect(meterSlot.pool.node, 0, meterSlot.slot);
            } catch {
                // The strip may already have detached every outgoing edge while
                // rebuilding. Ownership cleanup must still complete.
            }
            meterSlot.pool.sources[meterSlot.slot] = null;
            meterSlot.pool.peaks[meterSlot.slot] = 0;
            this.slots.delete(id);
            this.removePoolIfEmpty(meterSlot.pool);
        }
    }

    public start(): void {
        if (this.started || this.disposed) {
            return;
        }
        try {
            for (const [id, source] of this.sources) {
                this.attach(id, source);
            }
        } catch (error) {
            for (const id of Array.from(this.slots.keys())) {
                this.detach(id);
            }
            throw error;
        }
        this.started = true;
    }

    public read(id: string): number {
        const meterSlot = this.slots.get(id);
        if (!meterSlot) {
            return 0;
        }
        const peak = meterSlot.pool.peaks[meterSlot.slot] ?? 0;
        meterSlot.pool.peaks[meterSlot.slot] = 0;
        return peak;
    }

    public reconnect(id: string): void {
        const source = this.sources.get(id);
        const meterSlot = this.slots.get(id);
        if (source && meterSlot) {
            source.connect(meterSlot.pool.node, 0, meterSlot.slot);
        }
    }

    public getTapCount(): number {
        return this.slots.size;
    }

    public getWorkletCount(): number {
        return this.pools.length;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        for (const id of Array.from(this.sources.keys())) {
            this.unregister(id);
        }
        this.disposed = true;
        this.started = false;
    }

    private attach(id: string, source: AudioNode): void {
        const pool = this.findOrCreatePool();
        const slot = pool.sources.indexOf(null);
        if (slot < 0) {
            throw new Error('Meter pool has no free slot.');
        }
        pool.peaks[slot] = 0;
        try {
            source.connect(pool.node, 0, slot);
        } catch (error) {
            this.removePoolIfEmpty(pool);
            throw error;
        }
        pool.sources[slot] = source;
        this.slots.set(id, { pool, slot });
    }

    private findOrCreatePool(): MeterPool {
        const available = this.pools.find((pool) => pool.sources.includes(null));
        if (available) {
            return available;
        }

        const sab = new SharedArrayBuffer(METER_SLOTS_PER_POOL * Float32Array.BYTES_PER_ELEMENT);
        const node = new AudioWorkletNode(this.context, 'metering-processor', {
            numberOfInputs: METER_SLOTS_PER_POOL,
            numberOfOutputs: 0,
            channelCount: 2,
            channelCountMode: 'max',
        });
        try {
            node.port.postMessage({ type: 'init', sab });
        } catch (error) {
            try {
                node.port.close();
            } catch {
                // Preserve the initialization error that made the pool unusable.
            }
            throw error;
        }
        const pool = {
            node,
            peaks: new Float32Array(sab),
            sources: Array<AudioNode | null>(METER_SLOTS_PER_POOL).fill(null),
        };
        this.pools.push(pool);
        return pool;
    }

    private removePoolIfEmpty(pool: MeterPool): void {
        if (pool.sources.some((source) => source !== null)) {
            return;
        }
        const index = this.pools.indexOf(pool);
        if (index >= 0) {
            this.pools.splice(index, 1);
        }
        try {
            pool.node.port.postMessage({ type: 'shutdown' });
        } catch {
            // Closing the port still releases the processor-side owner.
        }
        try {
            pool.node.port.close();
        } catch {
            // The context may already have closed the port during teardown.
        }
    }
}
