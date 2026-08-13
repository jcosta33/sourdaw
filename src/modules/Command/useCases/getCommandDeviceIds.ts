function visit(value: unknown, key: string | null, deviceIds: Set<string>): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            visit(item, key, deviceIds);
        }
        return;
    }
    if (typeof value === 'object' && value !== null) {
        for (const [childKey, childValue] of Object.entries(value)) {
            visit(childValue, childKey, deviceIds);
        }
        return;
    }
    if (
        typeof value === 'string' &&
        value !== '' &&
        key !== null &&
        (key === 'deviceId' || key.endsWith('DeviceId') || key.endsWith('DeviceIds'))
    ) {
        deviceIds.add(value);
    }
}

export function getCommandDeviceIds(argumentsValue: Readonly<Record<string, unknown>>): string[] {
    const deviceIds = new Set<string>();
    visit(argumentsValue, null, deviceIds);
    return [...deviceIds].sort();
}
