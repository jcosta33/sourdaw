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
};
type ActiveProjectedNote = Omit<ProjectedOfflineYeastNote, 'endSamples'> & { noteInstanceId?: string };

export function projectOfflineYeastNotes({
    trackId,
    notes,
    sampleRate,
    blockEndSamples,
    projectPpqEndpoints,
    processYeastMidi,
}: ProjectOfflineYeastNotesInput): ProjectedOfflineYeastNote[] {
    const events = notes.flatMap((note, index) => {
        const endpoint = projectPpqEndpoints({
            startPpq: note.startBeat,
            endPpq: note.startBeat + note.duration,
        });
        const noteInstanceId = `${trackId}:${note.id}:${index}:${endpoint.startSamples}`;
        return [
            {
                timeSamples: endpoint.startSamples,
                timePpq: note.startBeat,
                trackId,
                sourceEventId: `${noteInstanceId}:on`,
                noteInstanceId,
                kind: { type: 'noteOn' as const, channel: 0, note: note.pitch, velocity: note.velocity },
            },
            {
                timeSamples: endpoint.endSamples,
                timePpq: note.startBeat + note.duration,
                trackId,
                sourceEventId: `${noteInstanceId}:off`,
                noteInstanceId,
                kind: { type: 'noteOff' as const, channel: 0, note: note.pitch },
            },
        ];
    });
    if (events.length === 0) {
        return [];
    }
    const blockStartSamples = Math.min(...events.map((event) => event.timeSamples));
    const processedEvents = processYeastMidi({
        trackId,
        sampleRate,
        blockStartSamples,
        blockEndSamples,
        events,
    });
    const activeByInstance = new Map<string, ActiveProjectedNote>();
    const activeByPitch = new Map<number, ActiveProjectedNote[]>();
    const projected: ProjectedOfflineYeastNote[] = [];

    for (let index = 0; index < processedEvents.length; index++) {
        const event = processedEvents[index]!;
        if (event.kind.type === 'noteOn') {
            const active: ActiveProjectedNote = {
                id: event.sourceEventId ?? `yeast:${trackId}:${index}`,
                pitch: event.kind.note,
                velocity: event.kind.velocity,
                startSamples: event.timeSamples,
                noteInstanceId: event.noteInstanceId,
            };
            if (event.noteInstanceId) {
                activeByInstance.set(event.noteInstanceId, active);
            } else {
                const key = (event.kind.channel << 7) | event.kind.note;
                const queue = activeByPitch.get(key) ?? [];
                queue.push(active);
                activeByPitch.set(key, queue);
            }
            continue;
        }
        if (event.kind.type !== 'noteOff') {
            continue;
        }
        let active: ActiveProjectedNote | undefined;
        if (event.noteInstanceId) {
            active = activeByInstance.get(event.noteInstanceId);
            activeByInstance.delete(event.noteInstanceId);
        } else {
            const key = (event.kind.channel << 7) | event.kind.note;
            const queue = activeByPitch.get(key);
            active = queue?.shift();
            if (queue?.length === 0) {
                activeByPitch.delete(key);
            }
        }
        if (!active || event.timeSamples <= active.startSamples) {
            continue;
        }
        projected.push({
            id: active.id,
            pitch: active.pitch,
            velocity: active.velocity,
            startSamples: active.startSamples,
            endSamples: event.timeSamples,
        });
    }
    return projected;
}
