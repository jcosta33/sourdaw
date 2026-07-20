import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';

type OfflineYeastProjectableNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};
type ProjectOfflineYeastNotesInput = {
    trackId: string;
    notes: readonly OfflineYeastProjectableNote[];
    sampleRate: number;
    blockStartSamples: number;
    blockEndSamples: number;
    projectPpqEndpoints: (input: { startPpq: number; endPpq: number }) => {
        startSamples: number;
        endSamples: number;
    };
    processYeastMidi: OfflineYeastMidiProcessor;
};
type ProjectedOfflineYeastNote = {
    id: string;
    pitch: number;
    velocity: number;
    startSamples: number;
    endSamples: number;
    startPpq: number;
    endPpq: number;
};
type ActiveProjectedNote = Omit<ProjectedOfflineYeastNote, 'endSamples' | 'endPpq'>;

export function projectOfflineYeastNotes({
    trackId,
    notes,
    sampleRate,
    blockStartSamples,
    blockEndSamples,
    projectPpqEndpoints,
    processYeastMidi,
}: ProjectOfflineYeastNotesInput): ProjectedOfflineYeastNote[] {
    const events = notes.flatMap((note) => {
        const endpoint = projectPpqEndpoints({
            startPpq: note.startBeat,
            endPpq: note.startBeat + note.duration,
        });
        return [
            {
                timeSamples: endpoint.startSamples,
                timePpq: note.startBeat,
                trackId,
                kind: { type: 'noteOn' as const, channel: 0, note: note.pitch, velocity: note.velocity },
            },
            {
                timeSamples: endpoint.endSamples,
                timePpq: note.startBeat + note.duration,
                trackId,
                kind: { type: 'noteOff' as const, channel: 0, note: note.pitch },
            },
        ];
    });
    const processedEvents = processYeastMidi({
        trackId,
        sampleRate,
        blockStartSamples,
        blockEndSamples,
        events,
    });
    const activeByPitch = new Map<number, ActiveProjectedNote[]>();
    const projected: ProjectedOfflineYeastNote[] = [];

    for (let index = 0; index < processedEvents.length; index++) {
        const event = processedEvents[index]!;
        const key = (event.kind.channel << 7) | ('note' in event.kind ? event.kind.note : 0);
        if (event.kind.type === 'noteOn') {
            if (event.timeSamples >= blockEndSamples) {
                continue;
            }
            const queue = activeByPitch.get(key) ?? [];
            queue.push({
                id: `yeast:${trackId}:${index}`,
                pitch: event.kind.note,
                velocity: event.kind.velocity,
                startSamples: event.timeSamples,
                startPpq: event.timePpq,
            });
            activeByPitch.set(key, queue);
            continue;
        }
        if (event.kind.type !== 'noteOff') {
            continue;
        }

        const queue = activeByPitch.get(key);
        const active = queue?.shift();
        if (queue?.length === 0) {
            activeByPitch.delete(key);
        }
        if (!active || event.timeSamples <= active.startSamples) {
            continue;
        }
        projected.push({
            ...active,
            endSamples: Math.min(event.timeSamples, blockEndSamples),
            endPpq: event.timePpq,
        });
    }

    return projected;
}
