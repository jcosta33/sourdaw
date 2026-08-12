import { getCommandDeviceIds } from './getCommandDeviceIds';
import { getCommandDeviceTypes } from './getCommandDeviceTypes';

type CommandDeviceTypeResolver = (input: {
    argumentsValue: Readonly<Record<string, unknown>>;
    deviceIds: readonly string[];
    operation: string;
}) => Readonly<Record<string, string>>;
type CommandDeviceVersionResolver = (deviceType: string) => string | undefined;

function resolveUnconfiguredDeviceTypes(): Readonly<Record<string, string>> {
    return {};
}

function resolveUnconfiguredDeviceVersion(deviceType: string): string {
    return `unconfigured-device-version:${deviceType}`;
}

let deviceTypeResolver: CommandDeviceTypeResolver = resolveUnconfiguredDeviceTypes;
let versionResolver: CommandDeviceVersionResolver = resolveUnconfiguredDeviceVersion;
let deviceTypeResolverConfigured = false;
let versionResolverConfigured = false;

export const commandDeviceVersionsPort = {
    capture(input: {
        argumentsValue: Readonly<Record<string, unknown>>;
        operation: string;
    }): Readonly<Record<string, string>> {
        if (deviceTypeResolverConfigured !== versionResolverConfigured) {
            throw new Error('Command device version resolution is only partially configured');
        }
        const directTypes = getCommandDeviceTypes(input.argumentsValue);
        const deviceIds = getCommandDeviceIds(input.argumentsValue);
        const resolvedTypes = deviceTypeResolver({
            argumentsValue: input.argumentsValue,
            deviceIds,
            operation: input.operation,
        });
        if (
            deviceTypeResolverConfigured &&
            directTypes.length === 0 &&
            deviceIds.some((deviceId) => resolvedTypes[deviceId] === undefined)
        ) {
            throw new Error(`Device version is unavailable for command ${input.operation}`);
        }
        const deviceTypes = [...new Set([...directTypes, ...Object.values(resolvedTypes)])].sort();
        const versions: Record<string, string> = {};
        for (const deviceType of deviceTypes) {
            const version = versionResolver(deviceType);
            if (version === undefined) {
                throw new Error(`Device version is unavailable for ${deviceType}`);
            }
            versions[deviceType] = version;
        }
        return versions;
    },
    isConfigured(): boolean {
        return deviceTypeResolverConfigured && versionResolverConfigured;
    },
    setDeviceTypeResolver(nextResolver: CommandDeviceTypeResolver | null): void {
        deviceTypeResolver = nextResolver ?? resolveUnconfiguredDeviceTypes;
        deviceTypeResolverConfigured = nextResolver !== null;
    },
    setResolver(nextResolver: CommandDeviceVersionResolver | null): void {
        versionResolver = nextResolver ?? resolveUnconfiguredDeviceVersion;
        versionResolverConfigured = nextResolver !== null;
    },
};
