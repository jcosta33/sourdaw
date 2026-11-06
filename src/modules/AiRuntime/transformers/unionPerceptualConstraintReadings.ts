import { type PerceptualConstraintReading } from '../models/PerceptualConstraint';

/**
 * Every constraint of every reading, once each by invariant and scope with the first clause stating it
 * kept, and every unsupported clause once, in the order the readings give them.
 */
export function unionPerceptualConstraintReadings(
    ...readings: ReadonlyArray<PerceptualConstraintReading | undefined>
): PerceptualConstraintReading {
    const union: PerceptualConstraintReading = { constraints: [], unsupported: [] };
    for (const reading of readings) {
        for (const constraint of reading?.constraints ?? []) {
            const held = union.constraints.some(
                (other) =>
                    other.constraintId === constraint.constraintId &&
                    JSON.stringify(other.scope) === JSON.stringify(constraint.scope)
            );
            if (!held) {
                union.constraints.push(structuredClone(constraint));
            }
        }
        for (const unsupported of reading?.unsupported ?? []) {
            if (!union.unsupported.some((other) => other.clause === unsupported.clause)) {
                union.unsupported.push(structuredClone(unsupported));
            }
        }
    }
    return union;
}
