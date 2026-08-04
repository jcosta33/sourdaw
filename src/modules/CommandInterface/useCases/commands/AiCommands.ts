import { raveStore } from '#/modules/BrowserAi/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type CallableCommandEntry } from '../searchCommandRegistry';
import { getSelectedClipId } from '../selectionHelpers/getSelectedClipId';

/**
 * RAVE weights are neither shipped nor hosted. `raveStore.models` holds only
 * the models BrowserAi found in OPFS, so gating on it withholds the palette
 * entry while there is nothing to load — and restores it, unchanged, the day
 * the weights are there.
 */
function isRaveModelPresent(modelId: string): boolean {
    return raveStore.value?.models.some((model) => model.id === modelId) ?? false;
}

function requireMidiClip(fn: (clipId: string) => void): () => void {
    return () => {
        const clipId = getSelectedClipId();
        if (!clipId) {
            notifyUser('Select a MIDI clip first', 'error');
            return;
        }
        fn(clipId);
    };
}

/** AI / generation commands — generate patterns, detect tempo/key, audio-to-MIDI, apply groove, structure detection, RAVE models. */
export const aiCommands: CallableCommandEntry[] = [
    {
        id: 'generate-drums',
        label: 'AI: Generate Drum Pattern',
        description: 'Create an algorithmic drum pattern on a MIDI track',
        category: 'AI',
        action: { type: 'generateDrumPattern', payload: { style: 'rock' } },
    },
    {
        id: 'generate-drums-house',
        label: 'AI: Generate Drums (House)',
        description: 'House-style drum pattern on a MIDI track',
        category: 'AI',
        action: { type: 'generateDrumPattern', payload: { style: 'house' } },
    },
    {
        id: 'generate-drums-hiphop',
        label: 'AI: Generate Drums (Hip-Hop)',
        description: 'Hip-hop drum pattern on a MIDI track',
        category: 'AI',
        action: { type: 'generateDrumPattern', payload: { style: 'hiphop' } },
    },
    {
        id: 'generate-melody',
        label: 'AI: Generate Melody',
        description: 'Create an algorithmic melody on a MIDI track',
        category: 'AI',
        action: { type: 'generateMelody', payload: { style: 'simple' } },
    },
    {
        id: 'generate-melody-jazz',
        label: 'AI: Generate Melody (Jazz)',
        description: 'Jazz-style melody on a MIDI track',
        category: 'AI',
        action: { type: 'generateMelody', payload: { style: 'jazz' } },
    },
    {
        id: 'generate-chords',
        label: 'AI: Generate Chord Progression',
        description: 'Create a chord progression on a MIDI track',
        category: 'AI',
        action: { type: 'generateChordProgression', payload: { style: 'pop' } },
    },
    {
        id: 'generate-chords-jazz',
        label: 'AI: Generate Chords (Jazz)',
        description: 'Jazz chord progression on a MIDI track',
        category: 'AI',
        action: { type: 'generateChordProgression', payload: { style: 'jazz' } },
    },
    {
        id: 'generate-bassline',
        label: 'AI: Generate Bassline',
        description: 'Create a bassline that follows the selected MIDI clip harmonically',
        category: 'AI',
        action: requireMidiClip((clipId) => {
            void executeAppAction({ type: 'generateBassline', payload: { clipId, style: 'root-fifth' } });
        }),
    },
    {
        id: 'complete-midi',
        label: 'AI: Complete MIDI (continue clip)',
        description: 'Extend the selected MIDI clip forward with AI-generated notes',
        category: 'AI',
        action: requireMidiClip((clipId) => {
            void executeAppAction({ type: 'completeMidi', payload: { clipId, bars: 4 } });
        }),
    },
    {
        id: 'variation-midi',
        label: 'AI: Create MIDI Variation',
        description: 'Create a variation of the selected MIDI clip on the same track',
        category: 'AI',
        action: requireMidiClip((clipId) => {
            void executeAppAction({ type: 'variationMidi', payload: { clipId, amount: 0.3 } });
        }),
    },
    {
        id: 'variation-midi-subtle',
        label: 'AI: Create Subtle MIDI Variation',
        description: 'Gentle variation (10% divergence) of the selected MIDI clip',
        category: 'AI',
        action: requireMidiClip((clipId) => {
            void executeAppAction({ type: 'variationMidi', payload: { clipId, amount: 0.1 } });
        }),
    },
    {
        id: 'variation-midi-wild',
        label: 'AI: Create Wild MIDI Variation',
        description: 'Major variation (60% divergence) of the selected MIDI clip',
        category: 'AI',
        action: requireMidiClip((clipId) => {
            void executeAppAction({ type: 'variationMidi', payload: { clipId, amount: 0.6 } });
        }),
    },
    {
        id: 'analyze-mix',
        label: 'Analyze Mix',
        description: 'Run frequency and level analysis on the mix',
        category: 'AI',
        action: { type: 'analyzeMix' },
    },
    {
        id: 'auto-fix-mix',
        label: 'Auto-Fix Mix',
        description: 'Analyze and automatically fix mix issues',
        category: 'AI',
        action: { type: 'autoFixMix' },
    },
    {
        id: 'detect-tempo',
        label: 'Detect Tempo',
        description: 'Detect the BPM of the selected audio clip',
        category: 'AI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'detectTempo', payload: { clipId } });
            }
        },
    },
    {
        id: 'detect-key',
        label: 'Detect Key',
        description: 'Detect the musical key of the selected audio clip',
        category: 'AI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'detectKey', payload: { clipId } });
            }
        },
    },
    {
        id: 'audio-to-midi',
        label: 'Audio to MIDI',
        description: 'Convert the selected audio clip to MIDI notes',
        category: 'AI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'audioToMidi', payload: { clipId } });
            }
        },
    },
    {
        id: 'apply-groove',
        label: 'Apply Groove Template',
        description: 'Apply a groove template to the selected clip',
        category: 'AI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'applyGroove', payload: { clipId, grooveId: 'swing-light' } });
            }
        },
    },

    {
        id: 'detect-song-structure',
        label: 'Detect Song Structure',
        description: 'Analyze clips and auto-create arrangement sections (intro, verse, chorus, etc.)',
        category: 'AI',
        action: { type: 'detectSongStructure', payload: {} },
    },
    {
        id: 'compare-to-reference',
        label: 'Compare to Reference Mix',
        description: 'Analyze your mix against a mastered reference for actionable feedback',
        category: 'AI',
        action: { type: 'compareToReference' },
    },
    {
        id: 'generate-all-transitions',
        label: 'Generate Transition Fills',
        description: 'Auto-generate drum fills and risers at all section boundaries',
        category: 'AI',
        action: { type: 'generateAllTransitions' },
    },
    {
        id: 'get-mentor-tips',
        label: 'Music Mentor Tips',
        description: 'Get AI feedback explaining why mixing decisions work or need improvement',
        category: 'AI',
        action: { type: 'getMentorTips' },
    },
    {
        id: 'load-rave-strings',
        label: 'Load RAVE: Strings',
        description: 'Load the levain strings neural synthesis model',
        category: 'AI',
        action: { type: 'loadRaveModel', payload: { modelId: 'rave-strings' } },
        isAvailable: () => isRaveModelPresent('rave-strings'),
    },
    {
        id: 'load-rave-vocals',
        label: 'Load RAVE: Vocals',
        description: 'Load the vocal synthesis neural model',
        category: 'AI',
        action: { type: 'loadRaveModel', payload: { modelId: 'rave-vocals' } },
        isAvailable: () => isRaveModelPresent('rave-vocals'),
    },
];
