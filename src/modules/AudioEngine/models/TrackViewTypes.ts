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
    externalPluginId?: string;
    externalInstanceId?: string;
};
