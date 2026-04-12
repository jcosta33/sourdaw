/** Shared type used by all device node factories. */
export type OfflineDeviceNode = {
    inputNode: AudioNode;
    outputNode: AudioNode;
    nodes: AudioNode[];
    /** Stop oscillators and release resources when the device is removed. */
    dispose?: () => void;
};
