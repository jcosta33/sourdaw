export type PreparedPersistenceAttempt = {
    generation: number;
    settled: Promise<void>;
    settle: () => void;
};

export type PreparedPersistenceWitness = {
    sequenceById: ReadonlyMap<string, number>;
    settlements: readonly Promise<void>[];
};

export function createPreparedAudioBufferPersistenceAttempts(onNoActiveLeases: (id: string) => void) {
    const activeLeaseCountsById = new Map<string, Map<string, number>>();
    const activeAttemptsById = new Map<string, Set<PreparedPersistenceAttempt>>();
    const attemptById = new Map<string, PreparedPersistenceAttempt>();
    const attemptSequenceById = new Map<string, number>();

    function register(id: string, generation: number, leaseId: string): PreparedPersistenceAttempt {
        let settle = (): void => undefined;
        const settled = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const attempt = { generation, settled, settle };
        attemptById.set(id, attempt);
        const activeAttempts = activeAttemptsById.get(id) ?? new Set<PreparedPersistenceAttempt>();
        activeAttempts.add(attempt);
        activeAttemptsById.set(id, activeAttempts);
        attemptSequenceById.set(id, (attemptSequenceById.get(id) ?? 0) + 1);
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
        const activeAttempts = activeAttemptsById.get(id);
        activeAttempts?.delete(attempt);
        if (activeAttempts?.size === 0) {
            activeAttemptsById.delete(id);
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

    function capture(ids: readonly string[]): PreparedPersistenceWitness {
        return {
            sequenceById: new Map(ids.map((id) => [id, attemptSequenceById.get(id) ?? 0] as const)),
            settlements: ids.flatMap((id) => [...(activeAttemptsById.get(id) ?? [])].map((attempt) => attempt.settled)),
        };
    }

    function isCurrent(witness: PreparedPersistenceWitness): boolean {
        return [...witness.sequenceById].every(([id, sequence]) => (attemptSequenceById.get(id) ?? 0) === sequence);
    }

    return { capture, hasActiveLeases, isCurrent, isLeaseActive, register, unregister, waitForSuperseding };
}
