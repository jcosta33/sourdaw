/**
 * AudioEngine-local view shape of Arrangement's Device/Clip/Track models
 * (AGENTS.md §95 — model isolation). Not re-exports.
 */

export type Device = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
    /** Opaque project-owned state passed through to the device's offline hydrator. */
    deviceState?: unknown;
    externalPluginId?: string;
    externalInstanceId?: string;
    /**
     * The native sample bank this device sounds, as the bank store keys it.
     *
     * Not project truth and never read off a saved device: a producer sets it
     * from `projectDeviceForNativeBody` for the one device type whose native
     * body is built from a staged bank rather than from `parameterValues`.
     */
    sampleBankKey?: string;
};
