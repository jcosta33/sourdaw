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
};
