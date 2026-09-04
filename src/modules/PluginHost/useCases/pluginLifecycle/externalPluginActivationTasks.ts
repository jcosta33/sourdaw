/**
 * `attachment: 'pending'` is an activation that succeeded against a host with
 * no engine running yet: the instance is loaded and holds its parameters, but
 * no engine has taken it, so it processes no audio until one starts and
 * `markExternalPluginEngineAttached` says so. It is `active` rather than
 * `failed` because nothing failed — loading before the first play is the
 * ordinary order a project opens in — and callers that reject a `failed`
 * activation would otherwise refuse every plugin in an unplayed project.
 */
export type ExternalPluginActivationResult =
    | { status: 'active'; attachment?: 'pending' }
    | { status: 'failed'; stage: 'load' | 'attach' | 'restore'; reason: string };

export const externalPluginActivationTasks = new Map<string, Promise<ExternalPluginActivationResult>>();
export const externalPluginActivationOutcomes = new Map<string, ExternalPluginActivationResult>();
export const externalPluginActivationEpoch = { current: 0 };
