import { createMidiError } from '../errors/MidiError';
import { type MidiNote } from '../models/MidiNote';

type ParsedTrack = {
    name: string;
    notes: MidiNote[];
    endTick: number;
};

type WorkerResponse =
    | { type: 'parsed'; tracks: ParsedTrack[]; ticksPerBeat: number; tempo: number }
    | { type: 'error'; message: string };

/**
 * §159.1 — .mid parsing runs in a dedicated Web Worker so large files don't
 * block the main thread. A fresh worker is spawned per call and terminated
 * after the result arrives; the parse is a one-shot so worker reuse would
 * only add lifecycle complexity.
 */
export async function readMidiFile(file: File): Promise<ParsedTrack[]> {
    const buffer = await file.arrayBuffer();

    return new Promise<ParsedTrack[]>((resolve, reject) => {
        const worker = new Worker(new URL('../workers/midiImportWorker.ts', import.meta.url), {
            type: 'module',
        });

        const cleanup = (): void => {
            worker.onmessage = null;
            worker.onerror = null;
            worker.terminate();
        };

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const msg = event.data;
            if (msg.type === 'parsed') {
                cleanup();
                resolve(msg.tracks);
            } else if (msg.type === 'error') {
                cleanup();
                reject(createMidiError(msg.message));
            }
        };
        worker.onerror = (err) => {
            cleanup();
            reject(createMidiError(err.message || 'MIDI import worker crashed'));
        };

        worker.postMessage({ type: 'parse', buffer }, [buffer]);
    });
}
