export function semanticRangeOverlaps(
    entityStartBeat: number,
    entityEndBeat: number,
    rangeStartBeat: number,
    rangeEndBeat: number
): boolean {
    if (entityStartBeat === entityEndBeat) {
        return entityStartBeat >= rangeStartBeat && entityStartBeat < rangeEndBeat;
    }
    return entityStartBeat < rangeEndBeat && entityEndBeat > rangeStartBeat;
}
