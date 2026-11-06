// Loop Station pad shortcut definitions are `loopStation.pad.r<row>c<col>.play`
// and `.record` (built in `stores/shortcutStore.ts`).

/** Whether a shortcut definition is a Loop Station pad, play or record. */
export function isLoopStationPadDefinitionId(definitionId: string): boolean {
    return definitionId.startsWith('loopStation.pad.');
}

/** Whether a shortcut definition is a Loop Station play pad, which fires only while the station is armed. */
export function isLoopStationPlayPadDefinitionId(definitionId: string): boolean {
    return isLoopStationPadDefinitionId(definitionId) && definitionId.endsWith('.play');
}
