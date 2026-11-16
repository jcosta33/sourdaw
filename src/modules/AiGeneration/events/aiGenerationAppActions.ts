import { type MidiClipNoteSnapshot } from '#/modules/MIDI/events';

type MidiGenerationClipReplaySnapshot = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'midi';
};

type MidiGenerationSourceReplaySnapshot = {
    trackId: string;
    clip: MidiGenerationClipReplaySnapshot;
    notes: MidiClipNoteSnapshot[];
};

type GeneratedMidiReplayOperation =
    | {
          kind: 'replace-notes';
          trackId: string;
          clip: MidiGenerationClipReplaySnapshot;
          expectedNotes: MidiClipNoteSnapshot[];
          replacementNotes: MidiClipNoteSnapshot[];
      }
    | {
          kind: 'create-clip';
          source: MidiGenerationSourceReplaySnapshot;
          targetTrackId: string;
          clip: MidiGenerationClipReplaySnapshot;
          notes: MidiClipNoteSnapshot[];
      }
    | {
          kind: 'create-track';
          source: MidiGenerationSourceReplaySnapshot;
          trackJson: string;
          trackIndex: number;
          clip: MidiGenerationClipReplaySnapshot;
          notes: MidiClipNoteSnapshot[];
      };

export type AiGenerationAppAction =
    | {
          type: 'generateDrumPattern';
          payload: {
              style: string;
              trackId?: string;
              bars?: number;
              density?: number;
              startBeat?: number;
              seed?: number;
          };
      }
    | {
          type: 'generateMelody';
          payload: {
              style: string;
              key?: number;
              scale?: string;
              trackId?: string;
              bars?: number;
              octave?: number;
              density?: number;
              startBeat?: number;
              seed?: number;
          };
      }
    | {
          type: 'generateChordProgression';
          payload: {
              style: string;
              key?: number;
              scale?: string;
              trackId?: string;
              bars?: number;
              voicing?: string;
              startBeat?: number;
              seed?: number;
          };
      }
    | {
          type: 'completeMidi';
          payload: { clipId: string; direction?: 'forward' | 'backward'; bars?: number };
      }
    | { type: 'variationMidi'; payload: { clipId: string; amount?: number } }
    | { type: 'generateBassline'; payload: { clipId: string; style?: string; trackId?: string } }
    | { type: 'replayGeneratedMidi'; payload: { operation: GeneratedMidiReplayOperation } }
    | {
          type: 'stemSeparate';
          payload: { clipId: string; stems?: string[] };
      }
    | { type: 'generateFill'; payload: { atBeat: number; durationBeats?: number; style?: string } }
    | { type: 'generateAllTransitions'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        aiGeneration: AiGenerationAppAction;
    }
}
