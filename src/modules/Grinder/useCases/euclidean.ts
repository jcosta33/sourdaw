/**
 * Euclidean rhythm generator — distributes k hits across n steps as evenly as possible.
 * Bjorklund algorithm (Toussaint 2005). Used to generate patterns in the step sequencer.
 */

export function euclidean(hits: number, steps: number, rotation: number = 0): boolean[] {
    if (steps <= 0) { return []; }
    if (hits <= 0) { return Array(steps).fill(false); }
    if (hits >= steps) { return Array(steps).fill(true); }

    // Bjorklund iterative algorithm
    type Group = boolean[];
    let groups: Group[] = [];
    for (let i = 0; i < hits; i++) { groups.push([true]); }
    for (let i = 0; i < steps - hits; i++) { groups.push([false]); }

    while (true) {
        const firstGroup = groups[0];
        if (!firstGroup) { break; }

        const splitPos = groups.findIndex((g) =>
            g.length !== firstGroup.length || g.some((v, j) => v !== firstGroup[j]!)
        );

        if (splitPos <= 0 || splitPos >= groups.length) { break; }

        const remainder = groups.length - splitPos;
        const take = Math.min(remainder, splitPos);

        const newGroups: Group[] = [];
        for (let i = 0; i < splitPos; i++) {
            const combined = [...groups[i]!];
            if (i < take) {
                combined.push(...groups[splitPos + i]!);
            }
            newGroups.push(combined);
        }
        for (let i = splitPos + take; i < groups.length; i++) {
            newGroups.push(groups[i]!);
        }

        groups = newGroups;
        if (groups.length <= 1) { break; }
    }

    // Flatten
    const pattern: boolean[] = [];
    for (const group of groups) {
        pattern.push(...group);
    }
    while (pattern.length < steps) { pattern.push(false); }

    // Rotate
    if (rotation > 0 && steps > 0) {
        const rot = rotation % steps;
        return [...pattern.slice(rot), ...pattern.slice(0, rot)];
    }
    return pattern;
}
