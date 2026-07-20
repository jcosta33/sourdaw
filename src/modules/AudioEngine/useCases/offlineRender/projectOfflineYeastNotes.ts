import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';

type OfflineYeastProjectableNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    routeId?: string;
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
    routeId: string;
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
                trackId: note.routeId ?? trackId,
                kind: { type: 'noteOn' as const, channel: 0, note: note.pitch, velocity: note.velocity },
            },
            {
                timeSamples: endpoint.endSamples,
                timePpq: note.startBeat + note.duration,
                trackId: note.routeId ?? trackId,
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
    const activeByRouteAndPitch = new Map<string, ActiveProjectedNote[]>();
    const projected: ProjectedOfflineYeastNote[] = [];

    for (let index = 0; index < processedEvents.length; index++) {
        const event = processedEvents[index]!;
        const routeId = event.trackId ?? trackId;
        const pitchKey = (event.kind.channel << 7) | ('note' in event.kind ? event.kind.note : 0);
        const key = `${routeId}:${pitchKey}`;
        if (event.kind.type === 'noteOn') {
            if (event.timeSamples >= blockEndSamples) {
                continue;
            }
            const queue = activeByRouteAndPitch.get(key) ?? [];
            queue.push({
                id: `yeast:${trackId}:${index}`,
                pitch: event.kind.note,
                velocity: event.kind.velocity,
                startSamples: event.timeSamples,
                startPpq: event.timePpq,
                routeId,
            });
            activeByRouteAndPitch.set(key, queue);
            continue;
        }
        if (event.kind.type !== 'noteOff') {
            continue;
        }

        const queue = activeByRouteAndPitch.get(key);
        const active = queue?.shift();
        if (queue?.length === 0) {
            activeByRouteAndPitch.delete(key);
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
