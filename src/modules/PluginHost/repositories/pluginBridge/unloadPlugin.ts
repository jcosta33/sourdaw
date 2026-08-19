import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

type PluginUnloadResult = [unloadedInstanceIds: string[], errors: string[]];
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function parsePluginUnloadResult(value: unknown): PluginUnloadResult {
    if (!Array.isArray(value) || !isStringArray(value[0]) || !isStringArray(value[1])) {
        throw new Error('Invalid unload_plugin response');
    }
    return [value[0], value[1]];
}
export async function unloadPlugin(instanceId?: string): Promise<PluginUnloadResult> {
    if (!isDesktopRuntime()) {
        return [instanceId ? [instanceId] : [], []];
    }
    return parsePluginUnloadResult(await desktopInvoke('unload_plugin', instanceId === undefined ? {} : { instanceId }));
}
