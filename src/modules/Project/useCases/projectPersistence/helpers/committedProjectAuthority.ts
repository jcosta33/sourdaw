// The project generation bumped only where a replacement actually replaces the
// document's authority (`resetCrdtProjectWithTransportStopped`'s switch). A
// transition that prepares, activates, or aborts before that switch leaves the
// same project and graph open, so this — not the transition bookkeeping — names
// the committed project a delayed content-readiness report belongs to.
let committedProjectGeneration = 0;

/** Record that a replacement has replaced the document's authority. */
export function commitProjectAuthority(): void {
    committedProjectGeneration += 1;
}

/** The committed project a delayed report belongs to, read as a generation. */
export const committedProject = {
    get generation(): number {
        return committedProjectGeneration;
    },
};
