type CommandDeviceVersionResolver = (deviceType: string) => string | undefined;

function resolveUnconfiguredDeviceVersion(deviceType: string): string {
    return `unconfigured-device-version:${deviceType}`;
}

let resolver: CommandDeviceVersionResolver = resolveUnconfiguredDeviceVersion;

export const commandDeviceVersionsPort = {
    capture(deviceTypes: readonly string[]): Readonly<Record<string, string>> {
        const versions: Record<string, string> = {};
        for (const deviceType of [...new Set(deviceTypes)].sort()) {
            const version = resolver(deviceType);
            if (version === undefined) {
                throw new Error(`Device version is unavailable for ${deviceType}`);
            }
            versions[deviceType] = version;
        }
        return versions;
    },
    setResolver(nextResolver: CommandDeviceVersionResolver | null): void {
        resolver = nextResolver ?? resolveUnconfiguredDeviceVersion;
    },
};
