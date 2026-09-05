import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

/**
 * One strip's chain as an unload left it, after releasing every chain entry
 * naming an instance the unload retired.
 *
 * The repository's own DTO for the native reply's `reports` entries; the
 * `pluginLifecycle` use case derives its own `ReleasedStripReport` from this
 * shape rather than the other way around, because a repository owns the wire
 * contract it parses.
 */
export type ReleasedStripReport = {
    kind: 'track' | 'bus';
    id: string;
    deviceIds: readonly string[];
};

type PluginUnloadResult = {
    unloadedInstanceIds: string[];
    errors: string[];
    reports: ReleasedStripReport[];
};

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Parse the `reports` a native `unload_plugin` reply carries: the final chain
 * of every strip the unload's own release touched.
 *
 * PluginHost's own reader rather than AudioEngine's `readNativeStripReports` —
 * the two modules read the same wire shape for different reasons, and a
 * use case's parsing of its own bridge reply stays with that bridge.
 */
function parseReleasedStripReports(value: unknown): ReleasedStripReport[] {
    if (!Array.isArray(value)) {
        throw new TypeError('Invalid unload_plugin response');
    }
    return value.map((entry) => {
        const report = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
        const kind = report?.kind;
        const id = report?.id;
        const deviceIds = report?.deviceIds;
        if ((kind !== 'track' && kind !== 'bus') || typeof id !== 'string' || !isStringArray(deviceIds)) {
            throw new TypeError('Invalid unload_plugin response');
        }
        return { kind, id, deviceIds };
    });
}

function parsePluginUnloadResult(value: unknown): PluginUnloadResult {
    const reply = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    if (
        reply === null ||
        !isStringArray(reply.unloadedInstanceIds) ||
        !isStringArray(reply.errors) ||
        !Array.isArray(reply.reports)
    ) {
        throw new TypeError('Invalid unload_plugin response');
    }
    return {
        unloadedInstanceIds: reply.unloadedInstanceIds,
        errors: reply.errors,
        reports: parseReleasedStripReports(reply.reports),
    };
}

export async function unloadPlugin(instanceId?: string): Promise<PluginUnloadResult> {
    if (!isDesktopRuntime()) {
        return { unloadedInstanceIds: instanceId ? [instanceId] : [], errors: [], reports: [] };
    }
    return parsePluginUnloadResult(
        await desktopInvoke('unload_plugin', instanceId === undefined ? {} : { instanceId })
    );
}
