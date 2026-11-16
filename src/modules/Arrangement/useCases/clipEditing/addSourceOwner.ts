import { type TempoSourceOwner } from '#/modules/Transport/stores';

export type OwnerFields = { owner: TempoSourceOwner; fields: Set<string> };

export function addSourceOwner(
    owners: Map<string, OwnerFields>,
    owner: TempoSourceOwner,
    fields: readonly string[]
): void {
    const key = JSON.stringify(owner);
    const existing = owners.get(key);
    const ownerFields = new Set(existing?.fields);
    for (const field of fields) {
        ownerFields.add(field);
    }
    owners.set(key, { owner, fields: ownerFields });
}
