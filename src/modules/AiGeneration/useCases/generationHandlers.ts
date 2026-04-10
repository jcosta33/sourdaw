import { applyDrumPatternToTrack } from './generateDrumPattern/applyToTrack';
import { type DrumPatternStyle } from './generateDrumPattern/algorithm';
import { applyMelodyToTrack } from './generateMelody/applyToTrack';
import { type ScaleType } from './generateMelody/algorithm';
import { applyChordProgressionToTrack } from './generateChordProgression/applyToTrack';
import { type ChordProgressionStyle, type ChordVoicing } from './generateChordProgression/algorithm';
import { extractGroove, applyGroove } from './grooveTemplate/operations';
import { getGrooveById } from '../models/factoryGrooves';
import { addTrack, getTrackStoreState } from '#/modules/Arrangement';
import { getTransportState } from '#/modules/Transport';

type GenerationHandlerDescription = {
    label: string;
};

type GenerationHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => GenerationHandlerDescription;
    undoable: boolean;
};

type GenerationAction =
    | {
          type: 'generateDrumPattern';
          payload: { trackId?: string; style: string; bars: number; density: number };
      }
    | {
          type: 'generateMelody';
          payload: { trackId?: string; style: string; key?: number; scale?: string; bars: number };
      }
    | {
          type: 'generateChordProgression';
          payload: { trackId?: string; style: string; key?: number; scale?: string; bars: number; voicing?: string };
      }
    | { type: 'extractGroove'; payload: { clipId: string } }
    | { type: 'applyGroove'; payload: { clipId: string; grooveId: string; amount: number } };

type GenerationActionOf<ActionType extends GenerationAction['type']> = Extract<GenerationAction, { type: ActionType }>;

type GenerationHandlers = {
    generateDrumPattern: GenerationHandler<GenerationActionOf<'generateDrumPattern'>>;
    generateMelody: GenerationHandler<GenerationActionOf<'generateMelody'>>;
    generateChordProgression: GenerationHandler<GenerationActionOf<'generateChordProgression'>>;
    extractGroove: GenerationHandler<GenerationActionOf<'extractGroove'>>;
    applyGroove: GenerationHandler<GenerationActionOf<'applyGroove'>>;
};

const VALID_DRUM_STYLES: ReadonlySet<string> = new Set([
    'four-on-floor',
    'breakbeat',
    'trap',
    'jazz',
    'latin',
    'rock',
    'dnb',
    'half-time',
]);

const VALID_MELODY_STYLES: ReadonlySet<string> = new Set(['simple', 'arpeggiated', 'stepwise', 'rhythmic', 'ambient']);

const VALID_SCALES: ReadonlySet<string> = new Set([
    'major',
    'minor',
    'pentatonic',
    'minor-pentatonic',
    'blues',
    'dorian',
    'mixolydian',
]);

const VALID_CHORD_STYLES: ReadonlySet<string> = new Set([
    'pop',
    'jazz',
    'classical',
    'edm',
    'blues',
    'rnb',
    'folk',
    'cinematic',
]);

const VALID_VOICINGS: ReadonlySet<string> = new Set(['close', 'open', 'spread', 'power']);

function resolveOrCreateMidiTrack(trackId: string | undefined, fallbackName: string): string | null {
    if (trackId) {
        return trackId;
    }

    const state = getTrackStoreState();
    const selectedId = state?.selectedTrackId;

    // Use selected track if it's a MIDI track
    if (selectedId) {
        const selected = state?.tracks.find((t) => t.id === selectedId);
        if (selected && selected.kind === 'midi') {
            return selectedId;
        }
    }

    // Fall back to first existing MIDI track
    const firstMidi = state?.tracks.find((t) => t.kind === 'midi');
    if (firstMidi) {
        return firstMidi.id;
    }

    // Create a new one only if none exist
    const newTrack = addTrack({ name: fallbackName, kind: 'midi' });
    return newTrack?.id ?? null;
}

/** Get the current playhead position as start beat for new clips. */
function getPlayheadBeat(): number {
    const transport = getTransportState();
    return transport?.playheadPosition ?? 0;
}

export const generationHandlers: GenerationHandlers = {
    generateDrumPattern: {
        execute: (a) => {
            const style = VALID_DRUM_STYLES.has(a.payload.style) ? (a.payload.style as DrumPatternStyle) : 'rock';

            const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Drums (${style})`);
            if (!trackId) {
                return;
            }

            applyDrumPatternToTrack(
                trackId,
                {
                    style,
                    bars: a.payload.bars,
                    density: a.payload.density,
                },
                getPlayheadBeat()
            );
        },
        describe: (a) => ({ label: `Generate ${a.payload.style} drum pattern` }),
        undoable: true,
    },

    generateMelody: {
        execute: (a) => {
            const style = VALID_MELODY_STYLES.has(a.payload.style)
                ? (a.payload.style as 'simple' | 'arpeggiated' | 'stepwise' | 'rhythmic' | 'ambient')
                : 'simple';

            const scale: ScaleType = VALID_SCALES.has(a.payload.scale ?? '') ? (a.payload.scale as ScaleType) : 'major';

            const key = typeof a.payload.key === 'number' ? Math.max(0, Math.min(11, a.payload.key)) : 0;

            const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Melody (${style})`);
            if (!trackId) {
                return;
            }

            applyMelodyToTrack(
                trackId,
                {
                    style,
                    key,
                    scale,
                    bars: a.payload.bars,
                },
                getPlayheadBeat()
            );
        },
        describe: (a) => ({ label: `Generate ${a.payload.style} melody` }),
        undoable: true,
    },

    generateChordProgression: {
        execute: (a) => {
            const style: ChordProgressionStyle = VALID_CHORD_STYLES.has(a.payload.style)
                ? (a.payload.style as ChordProgressionStyle)
                : 'pop';

            const scale = a.payload.scale === 'major' || a.payload.scale === 'minor' ? a.payload.scale : 'major';

            const key = typeof a.payload.key === 'number' ? Math.max(0, Math.min(11, a.payload.key)) : 0;

            const voicing: ChordVoicing = VALID_VOICINGS.has(a.payload.voicing ?? '')
                ? (a.payload.voicing as ChordVoicing)
                : 'close';

            const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Chords (${style})`);
            if (!trackId) {
                return;
            }

            applyChordProgressionToTrack(
                trackId,
                {
                    style,
                    key,
                    scale,
                    bars: a.payload.bars,
                    voicing,
                },
                getPlayheadBeat()
            );
        },
        describe: (a) => ({ label: `Generate ${a.payload.style} chord progression` }),
        undoable: true,
    },

    extractGroove: {
        execute: (a) => {
            extractGroove(a.payload.clipId);
        },
        describe: () => ({ label: 'Extract groove template' }),
        undoable: false,
    },

    applyGroove: {
        execute: (a) => {
            const template = getGrooveById(a.payload.grooveId);
            if (!template) {
                return;
            }
            applyGroove(a.payload.clipId, template, a.payload.amount);
        },
        describe: (a) => ({ label: `Apply groove "${a.payload.grooveId}"` }),
        undoable: true,
    },
};
