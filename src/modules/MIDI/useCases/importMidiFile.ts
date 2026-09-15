import { createMidiError } from '../errors/MidiError';
import { type MidiCC, type MidiNote } from '../models/MidiNote';

type ParsedTrack = {
    name: string;
    notes: MidiNote[];
    ccs: MidiCC[];
    endTick: number;
};

export type ReadMidiFileResult = {
    /** The track count the file's header declared, recovered or not. */
    declaredTrackCount: number;
    tracks: ParsedTrack[];
    /** True when the parse recovered less than the header declared. */
    truncated: boolean;
};

type WorkerResponse =
    | {
          type: 'parsed';
          tracks: ParsedTrack[];
          ticksPerBeat: number;
          tempo: number;
          declaredTrackCount: number;
          truncated: boolean;
      }
    | { type: 'error'; message: string };

/**
 * Ceiling on a single parse. The worker is pure CPU over an in-memory buffer,
 * so even a multi-megabyte multitrack file finishes far inside this; anything
 * that does not is stuck rather than slow.
 */
const MIDI_IMPORT_TIMEOUT_MS = 30_000;

/**
 * §159.1 — .mid parsing runs in a dedicated Web Worker so large files don't
 * block the main thread. A fresh worker is spawned per call and terminated
 * after the result arrives; the parse is a one-shot so worker reuse would
 * only add lifecycle complexity.
 */
export async function readMidiFile(file: File): Promise<ReadMidiFileResult> {
    const buffer = await file.arrayBuffer();

    return new Promise<ReadMidiFileResult>((resolve, reject) => {
        const worker = new Worker(new URL('../workers/midiImportWorker.ts', import.meta.url), {
            type: 'module',
        });

        // A worker that never answers — a parse stuck in a loop, a module that
        // failed to evaluate — would otherwise leave this promise pending
        // forever and the import UI waiting on it with no way out.
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(createMidiError(`MIDI import timed out after ${MIDI_IMPORT_TIMEOUT_MS} ms`));
        }, MIDI_IMPORT_TIMEOUT_MS);

        function cleanup(): void {
            clearTimeout(timeoutId);
            worker.onmessage = null;
            worker.onerror = null;
            worker.terminate();
        }

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const msg = event.data;
            if (msg.type === 'parsed') {
                cleanup();
                resolve({
                    declaredTrackCount: msg.declaredTrackCount,
                    tracks: msg.tracks,
                    truncated: msg.truncated,
                });
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
