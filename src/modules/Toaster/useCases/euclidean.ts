/**
 * Euclidean rhythm generator — distributes k hits across n steps as evenly as possible.
 * Bjorklund algorithm (Toussaint 2005). Used to generate patterns in the step sequencer.
 */

export function euclidean(hits: number, steps: number, rotation: number = 0): boolean[] {
    if (steps <= 0) {
        return [];
    }
    if (hits <= 0) {
        return Array.from({ length: steps }, () => false);
    }
    if (hits >= steps) {
        return Array.from({ length: steps }, () => true);
    }

    // Bjorklund iterative algorithm
    type Group = boolean[];
    let groups: Group[] = [];
    for (let index = 0; index < hits; index++) {
        groups.push([true]);
    }
    for (let index = 0; index < steps - hits; index++) {
        groups.push([false]);
    }

    while (true) {
        const firstGroup = groups[0];
        if (!firstGroup) {
            break;
        }

        const splitPos = groups.findIndex(
            (g) => g.length !== firstGroup.length || g.some((value, jIndex) => value !== firstGroup[jIndex]!)
        );

        if (splitPos <= 0 || splitPos >= groups.length) {
            break;
        }

        const remainder = groups.length - splitPos;
        const take = Math.min(remainder, splitPos);

        const newGroups: Group[] = [];
        for (let index = 0; index < splitPos; index++) {
            const combined = [...groups[index]!];
            if (index < take) {
                combined.push(...groups[splitPos + index]!);
            }
            newGroups.push(combined);
        }
        for (let index = splitPos + take; index < groups.length; index++) {
            newGroups.push(groups[index]!);
        }

        groups = newGroups;
        if (groups.length <= 1) {
            break;
        }
    }

    // Flatten
    const pattern: boolean[] = [];
    for (const group of groups) {
        pattern.push(...group);
    }
    while (pattern.length < steps) {
        pattern.push(false);
    }

    // Rotate
    if (rotation > 0 && steps > 0) {
        const rot = rotation % steps;
        return [...pattern.slice(rot), ...pattern.slice(0, rot)];
    }
    return pattern;
}
