import { schedulerSession } from './schedulerSession';

function drain(): void {
    if (schedulerSession.pendingInitialEmissions.size > 0) {
        return;
    }
    for (const retire of schedulerSession.deferredStartRetirements.splice(0)) {
        retire();
    }
}

/**
 * Refused punch-in start retirements, held while any scheduler session's
 * initial emission prepares, because their store writes would stale its
 * programme witness.
 */
export const initialEmissionRetirements = {
    /**
     * Hold retirements while this initial emission prepares. The returned
     * close is idempotent and runs every held retirement once no emission is
     * left preparing.
     */
    open: (): (() => void) => {
        const emission = Symbol('initial emission');
        schedulerSession.pendingInitialEmissions.add(emission);
        return () => {
            schedulerSession.pendingInitialEmissions.delete(emission);
            drain();
        };
    },
    /** Retire a refused start now, or once no initial emission is preparing. */
    defer: (retire: () => void): void => {
        if (schedulerSession.pendingInitialEmissions.size > 0) {
            schedulerSession.deferredStartRetirements.push(retire);
            return;
        }
        retire();
    },
    /** Forget every preparing emission, so a disposed one cannot hold retirements forever, and run them. */
    forget: (): void => {
        schedulerSession.pendingInitialEmissions.clear();
        drain();
    },
};
