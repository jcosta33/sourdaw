/** Serializes the real lifetime of this spec's shared project and provider fixtures. */
export function createAcceptanceFixtureLifetime() {
    let pending: Promise<void> = Promise.resolve();
    let active = false;

    function track<T>(work: () => Promise<T>): Promise<T> {
        if (active) throw new Error('A shared acceptance fixture is still active.');
        active = true;
        const result = Promise.resolve().then(work);
        const settled = result.then(
            () => {
                if (pending === settled) active = false;
            },
            () => {
                if (pending === settled) active = false;
            }
        );
        pending = settled;
        return result;
    }

    function cleanup(work: () => void | Promise<void>): Promise<void> {
        const result = pending.then(work);
        active = true;
        const settled = result.then(
            () => {
                if (pending === settled) active = false;
            },
            (error: unknown) => {
                active = true;
                throw error;
            }
        );
        pending = settled;
        void pending.catch(() => undefined);
        return result;
    }

    return { track, cleanup, drain: () => pending };
}

/** Refuse partial, duplicate or unexpected case populations before scoring. */
export function completeAcceptanceResults<T>(expected: readonly string[], results: ReadonlyMap<string, T>): T[] {
    if (
        new Set(expected).size !== expected.length ||
        results.size !== expected.length ||
        expected.some((id) => !results.has(id))
    ) {
        throw new Error('Acceptance corpus results do not cover the exact frozen case population.');
    }
    return expected.map((id) => {
        const result = results.get(id);
        if (result === undefined) throw new Error(`Acceptance case ${id} has no result.`);
        return result;
    });
}
