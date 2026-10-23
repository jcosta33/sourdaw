type ProtectedObject = { id: string; name: string };

/** Every protected object of every group, once each by id, the first name given for it kept. */
export function unionProtectedObjects(...groups: ReadonlyArray<readonly ProtectedObject[]>): ProtectedObject[] {
    const byId = new Map<string, ProtectedObject>();
    for (const object of groups.flat()) {
        if (!byId.has(object.id)) {
            byId.set(object.id, { id: object.id, name: object.name });
        }
    }
    return Array.from(byId.values());
}
