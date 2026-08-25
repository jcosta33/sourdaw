export type PreparedPersistenceAttempt = {
    generation: number;
    settled: Promise<void>;
    settle: () => void;
};

export function createPreparedAudioBufferPersistenceAttempts(onNoActiveLeases: (id: string) => void) {
    const activeLeaseCountsById = new Map<string, Map<string, number>>();
    const attemptById = new Map<string, PreparedPersistenceAttempt>();

    function register(id: string, generation: number, leaseId: string): PreparedPersistenceAttempt {
        let settle = (): void => undefined;
        const settled = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const attempt = { generation, settled, settle };
        attemptById.set(id, attempt);
        const leaseCounts = activeLeaseCountsById.get(id) ?? new Map<string, number>();
        leaseCounts.set(leaseId, (leaseCounts.get(leaseId) ?? 0) + 1);
        activeLeaseCountsById.set(id, leaseCounts);
        return attempt;
    }

    function unregister(id: string, leaseId: string, attempt: PreparedPersistenceAttempt): void {
        attempt.settle();
        if (attemptById.get(id) === attempt) {
            attemptById.delete(id);
        }
        const leaseCounts = activeLeaseCountsById.get(id);
        const remainingForLease = (leaseCounts?.get(leaseId) ?? 1) - 1;
        if (remainingForLease > 0) {
            leaseCounts?.set(leaseId, remainingForLease);
        } else {
            leaseCounts?.delete(leaseId);
        }
        if (leaseCounts?.size === 0) {
            activeLeaseCountsById.delete(id);
            onNoActiveLeases(id);
        }
    }

    function isLeaseActive(id: string, leaseId: string): boolean {
        return (activeLeaseCountsById.get(id)?.get(leaseId) ?? 0) > 0;
    }

    function hasActiveLeases(id: string): boolean {
        return activeLeaseCountsById.has(id);
    }

    async function waitForSuperseding(id: string, generation: number): Promise<void> {
        for (;;) {
            const attempt = attemptById.get(id);
            if (!attempt || attempt.generation <= generation) {
                return;
            }
            await attempt.settled;
        }
    }

    return { hasActiveLeases, isLeaseActive, register, unregister, waitForSuperseding };
}
