import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { applyDrumPatternToTrack, type DrumPatternStyle } from '#/modules/AiGeneration/useCases/generateDrumPattern';
import { applyMelodyToTrack, type ScaleType } from '#/modules/AiGeneration/useCases/generateMelody';
import {
    applyChordProgressionToTrack,
    type ChordProgressionStyle,
    type ChordVoicing,
} from '#/modules/AiGeneration/useCases/generateChordProgression';
import { extractGroove, applyGroove, getGrooveById } from '#/modules/AiGeneration/useCases/grooveTemplate';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/trackQueries';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

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
    if (selectedId) {
        const selected = state?.tracks.find((t) => t.id === selectedId);
        if (selected && selected.kind === 'midi') {
            return selectedId;
        }
    }

    const newTrack = addTrack({ name: fallbackName, kind: 'midi' });
    return newTrack?.id ?? null;
}

export const generationHandlers = {
    generateDrumPattern: {
        execute: (a) => {
            const style = VALID_DRUM_STYLES.has(a.payload.style) ? (a.payload.style as DrumPatternStyle) : 'rock';

            const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Drums (${style})`);
            if (!trackId) {
                return;
            }

            applyDrumPatternToTrack(trackId, {
                style,
                bars: a.payload.bars,
                density: a.payload.density,
            });
        },
        describe: (a) => ({ label: `Generate ${a.payload.style} drum pattern` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'generateDrumPattern'>>,

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

            applyMelodyToTrack(trackId, {
                style,
                key,
                scale,
                bars: a.payload.bars,
            });
        },
        describe: (a) => ({ label: `Generate ${a.payload.style} melody` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'generateMelody'>>,

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

            applyChordProgressionToTrack(trackId, {
                style,
                key,
                scale,
                bars: a.payload.bars,
                voicing,
            });
        },
        describe: (a) => ({ label: `Generate ${a.payload.style} chord progression` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'generateChordProgression'>>,

    extractGroove: {
        execute: (a) => {
            extractGroove(a.payload.clipId);
        },
        describe: () => ({ label: 'Extract groove template' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'extractGroove'>>,

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
    } satisfies ActionHandler<Extract<AppAction, 'applyGroove'>>,
};
