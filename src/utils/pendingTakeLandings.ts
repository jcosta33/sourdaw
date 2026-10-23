/**
 * Take writes that land after the transport's falling edge, outside the stop's
 * own commit: an overdub pass's controller rows wait behind the snapshot
 * transaction queue, so the stop that ended the take must not report settled
 * until they have landed or been refused. The owner of such a write registers
 * it here; the Transport module, which cannot be imported from the owner,
 * reads the registry for its idle check, its stop and its settled-take count.
 */

/** Landings that have not settled; each removes itself as it settles. */
const inFlight = new Set<Promise<void>>();

let settledCount = 0;

function track(landing: Promise<void>): void {
    const onSettled = (): void => {
        inFlight.delete(settled);
        settledCount++;
    };
    const settled = landing.then(onSettled, onSettled);
    inFlight.add(settled);
}

async function waitForSettled(): Promise<void> {
    // Landings registered while this waits are awaited too, and the wait ends on
    // the landings' own settlement, never on an observer having run.
    while (inFlight.size > 0) {
        const landings = [...inFlight];
        await Promise.allSettled(landings);
        for (const settled of landings) {
            inFlight.delete(settled);
        }
    }
}

export const pendingTakeLandings = {
    /** Own a write that lands after the take's falling edge. A rejection counts as settled. */
    track,
    /** True while a tracked landing has neither landed nor been refused. */
    isLanding: (): boolean => inFlight.size > 0,
    /** How many tracked landings have settled, whether they landed or were refused. */
    countSettled: (): number => settledCount,
    /** Resolve once every tracked landing has settled, including ones registered while waiting. */
    waitForSettled,
};
