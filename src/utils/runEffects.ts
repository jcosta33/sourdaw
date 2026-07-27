type Effect = () => void;
type AsyncEffect = () => void | Promise<void>;

function throwEffectFailures(failures: unknown[]): void {
    if (failures.length === 0) {
        return;
    }
    if (failures.length === 1) {
        throw failures[0];
    }
    throw new AggregateError(failures, 'Multiple required effects failed');
}

export function runAllEffects(effects: readonly Effect[]): void {
    const failures: unknown[] = [];
    for (const effect of effects) {
        try {
            effect();
        } catch (error) {
            failures.push(error);
        }
    }
    throwEffectFailures(failures);
}

export async function runAllAsyncEffects(effects: readonly AsyncEffect[]): Promise<void> {
    const failures: unknown[] = [];
    for (const effect of effects) {
        try {
            await effect();
        } catch (error) {
            failures.push(error);
        }
    }
    throwEffectFailures(failures);
}
