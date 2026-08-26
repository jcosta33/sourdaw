export type ExternalPluginActivationResult =
    { status: 'active' } | { status: 'failed'; stage: 'load' | 'attach' | 'restore'; reason: string };

export const externalPluginActivationTasks = new Map<string, Promise<ExternalPluginActivationResult>>();
export const externalPluginActivationOutcomes = new Map<string, ExternalPluginActivationResult>();
export const externalPluginActivationEpoch = { current: 0 };
