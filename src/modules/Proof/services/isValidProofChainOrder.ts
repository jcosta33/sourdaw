export function isValidProofChainOrder(order: readonly number[]): boolean {
    return (
        order.length === 5 &&
        order.every((moduleId) => Number.isInteger(moduleId) && moduleId >= 0 && moduleId <= 4) &&
        new Set(order).size === 5
    );
}
