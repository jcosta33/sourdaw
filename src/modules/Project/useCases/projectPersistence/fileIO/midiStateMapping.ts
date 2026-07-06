type MapProjectMidiValuesInput<InputEntry, OutputEntry> = {
    byClipId: Record<string, InputEntry[]> | undefined;
    mapEntry: (entry: InputEntry, index: number, clipId: string) => OutputEntry;
};

type MapProjectMidiValuesOutput<OutputEntry> = Record<string, OutputEntry[]>;

export function mapProjectMidiValues<InputEntry, OutputEntry>({
    byClipId,
    mapEntry,
}: MapProjectMidiValuesInput<InputEntry, OutputEntry>): MapProjectMidiValuesOutput<OutputEntry> {
    const out: MapProjectMidiValuesOutput<OutputEntry> = {};
    for (const [clipId, entries] of Object.entries(byClipId ?? {})) {
        out[clipId] = entries.map((entry, index) => mapEntry(entry, index, clipId));
    }
    return out;
}
