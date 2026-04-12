/** Shared type used by all device node factories. */
export type OfflineDeviceNode = {
    inputNode: AudioNode;
    outputNode: AudioNode;
    nodes: AudioNode[];
    /**
     * Named references to internal nodes, keyed by semantic role.
     * Avoids fragile positional indexing into `nodes[]`.
     */
    namedNodes?: Record<string, AudioNode>;
    /** Stop oscillators and release resources when the device is removed. */
    dispose?: () => void;
};
