let openProjectChoices = 0;

/**
 * `projectStore` keeps the open project until a replacement's activation, so
 * choosing the open project's own Recent entry while another replacement is
 * still saving or reading cannot start a load of its own. It withdraws the
 * pending ones instead, leaving the session where the user last chose to be.
 */
export const pendingRecentLoads = {
    /**
     * Capture the Recent loads pending right now. The returned check turns
     * false once the open project's entry has been chosen since.
     */
    capture(): () => boolean {
        const capturedChoices = openProjectChoices;
        return () => openProjectChoices === capturedChoices;
    },
    /** Record that the open project's own Recent entry was chosen, withdrawing every pending Recent load. */
    withdraw(): void {
        openProjectChoices += 1;
    },
};
