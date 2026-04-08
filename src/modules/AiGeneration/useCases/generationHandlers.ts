import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { applyDrumPatternToTrack } from '#/modules/AiGeneration/useCases/generateDrumPattern/applyToTrack';
import { type DrumPatternStyle } from '#/modules/AiGeneration/useCases/generateDrumPattern/algorithm';
import { applyMelodyToTrack } from '#/modules/AiGeneration/useCases/generateMelody/applyToTrack';
import { type ScaleType } from '#/modules/AiGeneration/useCases/generateMelody/algorithm';
import { applyChordProgressionToTrack } from '#/modules/AiGeneration/useCases/generateChordProgression/applyToTrack';
import {
    type ChordProgressionStyle,
    type ChordVoicing,
} from '#/modules/AiGeneration/useCases/generateChordProgression/algorithm';
import { extractGroove, applyGroove } from '#/modules/AiGeneration/useCases/grooveTemplate/operations';
import { getGrooveById } from '#/modules/AiGeneration/models/factoryGrooves';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';

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

type MidiTrackDeps = {
    getTrackStoreState: typeof getTrackStoreState;
    addTrack: typeof addTrack;
};

function resolveOrCreateMidiTrack(
    trackId: string | undefined,
    fallbackName: string,
    deps: MidiTrackDeps
): string | null {
    if (trackId) {
        return trackId;
    }

    const state = deps.getTrackStoreState();
    const selectedId = state?.selectedTrackId;

    if (selectedId) {
        const selected = state?.tracks.find((t) => t.id === selectedId);
        if (selected && selected.kind === 'midi') {
            return selectedId;
        }
    }

    const firstMidi = state?.tracks.find((t) => t.kind === 'midi');
    if (firstMidi) {
        return firstMidi.id;
    }

    const newTrack = deps.addTrack({ name: fallbackName, kind: 'midi' });
    return newTrack?.id ?? null;
}

function getPlayheadBeat(deps: { getTransportState: typeof getTransportState }): number {
    const transport = deps.getTransportState();
    return transport?.playheadPosition ?? 0;
}

export const executeGenerateDrumPattern = inject({
    getTrackStoreState,
    addTrack,
    getTransportState,
    applyDrumPatternToTrack,
})(
    ({ getTrackStoreState, addTrack, getTransportState, applyDrumPatternToTrack }) =>
        function executeGenerateDrumPattern(a: Extract<AppAction, 'generateDrumPattern'>): void {
            const style = VALID_DRUM_STYLES.has(a.payload.style) ? (a.payload.style as DrumPatternStyle) : 'rock';

            const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Drums (${style})`, {
                getTrackStoreState,
                addTrack,
            });
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
                getPlayheadBeat({ getTransportState })
            );
        }
);

export const executeGenerateMelody = inject({
    getTrackStoreState,
    addTrack,
    getTransportState,
    applyMelodyToTrack,
})(
    ({ getTrackStoreState, addTrack, getTransportState, applyMelodyToTrack }) =>
        function executeGenerateMelody(a: Extract<AppAction, 'generateMelody'>): void {
            const style = VALID_MELODY_STYLES.has(a.payload.style)
                ? (a.payload.style as 'simple' | 'arpeggiated' | 'stepwise' | 'rhythmic' | 'ambient')
                : 'simple';

            const scale: ScaleType = VALID_SCALES.has(a.payload.scale ?? '') ? (a.payload.scale as ScaleType) : 'major';

            const key = typeof a.payload.key === 'number' ? Math.max(0, Math.min(11, a.payload.key)) : 0;

            const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Melody (${style})`, {
                getTrackStoreState,
                addTrack,
            });
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
                getPlayheadBeat({ getTransportState })
            );
        }
);

export const executeGenerateChordProgression = inject({
    getTrackStoreState,
    addTrack,
    getTransportState,
    applyChordProgressionToTrack,
})(
    ({ getTrackStoreState, addTrack, getTransportState, applyChordProgressionToTrack }) =>
        function executeGenerateChordProgression(a: Extract<AppAction, 'generateChordProgression'>): void {
            const style: ChordProgressionStyle = VALID_CHORD_STYLES.has(a.payload.style)
                ? (a.payload.style as ChordProgressionStyle)
                : 'pop';

            const scale = a.payload.scale === 'major' || a.payload.scale === 'minor' ? a.payload.scale : 'major';

            const key = typeof a.payload.key === 'number' ? Math.max(0, Math.min(11, a.payload.key)) : 0;

            const voicing: ChordVoicing = VALID_VOICINGS.has(a.payload.voicing ?? '')
                ? (a.payload.voicing as ChordVoicing)
                : 'close';

            const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Chords (${style})`, {
                getTrackStoreState,
                addTrack,
            });
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
                getPlayheadBeat({ getTransportState })
            );
        }
);

export const executeExtractGroove = inject({ extractGroove })(
    ({ extractGroove }) =>
        function executeExtractGroove(a: Extract<AppAction, 'extractGroove'>): void {
            extractGroove(a.payload.clipId);
        }
);

export const executeApplyGroove = inject({ getGrooveById, applyGroove })(
    ({ getGrooveById, applyGroove }) =>
        function executeApplyGroove(a: Extract<AppAction, 'applyGroove'>): void {
            const template = getGrooveById(a.payload.grooveId);
            if (!template) {
                return;
            }
            applyGroove(a.payload.clipId, template, a.payload.amount);
        }
);

export const generationHandlers = {
    generateDrumPattern: {
        execute: executeGenerateDrumPattern,
        describe: (a) => ({ label: `Generate ${a.payload.style} drum pattern` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'generateDrumPattern'>>,

    generateMelody: {
        execute: executeGenerateMelody,
        describe: (a) => ({ label: `Generate ${a.payload.style} melody` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'generateMelody'>>,

    generateChordProgression: {
        execute: executeGenerateChordProgression,
        describe: (a) => ({ label: `Generate ${a.payload.style} chord progression` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'generateChordProgression'>>,

    extractGroove: {
        execute: executeExtractGroove,
        describe: () => ({ label: 'Extract groove template' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'extractGroove'>>,

    applyGroove: {
        execute: executeApplyGroove,
        describe: (a) => ({ label: `Apply groove "${a.payload.grooveId}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'applyGroove'>>,
};
