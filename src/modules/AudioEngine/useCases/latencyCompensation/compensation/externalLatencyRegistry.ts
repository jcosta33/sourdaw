class ExternalLatencyRegistry extends Map<string, number> {
    #revision = 0;

    get revision(): number {
        return this.#revision;
    }

    override set(deviceId: string, latencyMs: number): this {
        if (this.get(deviceId) !== latencyMs) {
            this.#revision += 1;
        }
        return super.set(deviceId, latencyMs);
    }

    override delete(deviceId: string): boolean {
        const deleted = super.delete(deviceId);
        if (deleted) {
            this.#revision += 1;
        }
        return deleted;
    }

    override clear(): void {
        this.#revision += 1;
        super.clear();
    }
}

export const externalLatencyRegistry = new ExternalLatencyRegistry();

/**
 * Drop every reported-latency entry. Called from the public resetAudioGraph()
 * project-reset path after the live engine graph is reset: without it the Map
 * accumulates one entry per latency-reporting device across project switches and
 * never shrinks, since the per-device clearReportedLatency only runs when a
 * device's destroy() fires and device ids do not recur across projects.
 */
export function clearAllReportedLatency(): void {
    externalLatencyRegistry.clear();
}
