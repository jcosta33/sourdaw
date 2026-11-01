const explicitlyCommittedKits = new WeakSet<object>();
export function markToasterKitCommitted(kit: object): void {
    explicitlyCommittedKits.add(kit);
}

export function wasToasterKitExplicitlyCommitted(kit: object): boolean {
    return explicitlyCommittedKits.has(kit);
}
