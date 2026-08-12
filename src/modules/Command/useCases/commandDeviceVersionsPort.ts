import { getCommandDeviceIds } from './getCommandDeviceIds';
import { getCommandDeviceTypes } from './getCommandDeviceTypes';

type CommandDeviceTypeResolver = (input: {
    argumentsValue: Readonly<Record<string, unknown>>;
    deviceIds: readonly string[];
    operation: string;
}) => Readonly<Record<string, string>>;
type CommandDeviceVersionResolver = (deviceType: string) => string | undefined;

function resolveNoDeviceTypes(): Readonly<Record<string, string>> {
    return {};
}

function resolveUnconfiguredDeviceVersion(deviceType: string): string {
    return `unconfigured-device-version:${deviceType}`;
}

let deviceTypeResolver: CommandDeviceTypeResolver = resolveNoDeviceTypes;
let versionResolver: CommandDeviceVersionResolver = resolveUnconfiguredDeviceVersion;

export const commandDeviceVersionsPort = {
    capture(input: {
        argumentsValue: Readonly<Record<string, unknown>>;
        operation: string;
    }): Readonly<Record<string, string>> {
        const directTypes = getCommandDeviceTypes(input.argumentsValue);
        const deviceIds = getCommandDeviceIds(input.argumentsValue);
        const resolvedTypes = deviceTypeResolver({
            argumentsValue: input.argumentsValue,
            deviceIds,
            operation: input.operation,
        });
        if (directTypes.length === 0 && deviceIds.some((deviceId) => resolvedTypes[deviceId] === undefined)) {
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
    setDeviceTypeResolver(nextResolver: CommandDeviceTypeResolver | null): void {
        deviceTypeResolver = nextResolver ?? resolveNoDeviceTypes;
    },
    setResolver(nextResolver: CommandDeviceVersionResolver | null): void {
        versionResolver = nextResolver ?? resolveUnconfiguredDeviceVersion;
    },
};
