function visit(value: unknown, key: string | null, deviceTypes: Set<string>): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            visit(item, key, deviceTypes);
        }
        return;
    }
    if (typeof value === 'object' && value !== null) {
        for (const [childKey, childValue] of Object.entries(value)) {
            visit(childValue, childKey, deviceTypes);
        }
        return;
    }
    if ((key === 'deviceType' || key === 'expectedDeviceType') && typeof value === 'string' && value !== '') {
        deviceTypes.add(value);
    }
}

export function getCommandDeviceTypes(argumentsValue: Readonly<Record<string, unknown>>): string[] {
    const deviceTypes = new Set<string>();
    visit(argumentsValue, null, deviceTypes);
    return [...deviceTypes].sort();
}
