/**
 * The transport a branch switch stops before it replaces the root document,
 * and asks again whether it is idle once nothing is left to await before the
 * replace.
 */
type BranchSwitchTransport = {
    /** Whether the transport is neither playing nor recording, nor about to. */
    isIdle: () => boolean;
    /** Stops playback and settles once a recording in flight has committed its take. */
    stop: () => Promise<void>;
};

let registeredTransport: BranchSwitchTransport | null = null;

/**
 * CrdtDocument is the shared truth kernel and may not import Transport, so the
 * composition root (`#/app/registerKernelPorts`) fills this once at boot,
 * before any branch can be switched.
 */
export const branchSwitchTransport = {
    /**
     * Registering the identical transport again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(transport: BranchSwitchTransport): void {
        if (registeredTransport === null) {
            registeredTransport = transport;
            return;
        }
        if (registeredTransport.isIdle !== transport.isIdle || registeredTransport.stop !== transport.stop) {
            throw new Error('branchSwitchTransport.configure: the transport differs from the registered one');
        }
    },
    /**
     * The registered transport. Reading before registration throws rather than
     * switching with the transport running: a take left recording would run on
     * into the incoming branch, and the replace clears undo mid-take.
     */
    read(caller: string): BranchSwitchTransport {
        if (registeredTransport === null) {
            throw new Error(
                `${caller}: the branch switch transport is not registered; call registerKernelPorts() from #/app/registerKernelPorts (bootstrap does this)`
            );
        }
        return registeredTransport;
    },
};
