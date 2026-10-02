import { getCloudProviderRuntime } from './getCloudProviderRuntime';

export function usesStrictCloudToolSchemas(): boolean {
    const runtime = getCloudProviderRuntime();
    return runtime !== null && (runtime.provider !== 'openai-compatible' || runtime.strict_tool_schemas === true);
}
