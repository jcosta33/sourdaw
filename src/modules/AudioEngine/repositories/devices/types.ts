/** Shared type used by all device node factories. */
export type OfflineDeviceNode = {
    inputNode: AudioNode;
    outputNode: AudioNode;
    nodes: AudioNode[];
};
