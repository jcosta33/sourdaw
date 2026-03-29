import { type CommandEntry } from '../CommandRegistry';
import { getSelectedClipId } from '../../useCases/selectionHelpers';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';

/** AI / generation commands — generate patterns, detect tempo/key, audio-to-MIDI, apply groove, structure detection, RAVE models. */
export const aiCommands: CommandEntry[] = [
    {
        id: 'generate-drums',
        label: 'Generate Drum Pattern',
        description: 'Create an algorithmic drum pattern on a MIDI track',
        category: 'AI',
        action: { type: 'generateDrumPattern', payload: { style: 'rock' } },
    },
    {
        id: 'generate-melody',
        label: 'Generate Melody',
        description: 'Create an algorithmic melody on a MIDI track',
        category: 'AI',
        action: { type: 'generateMelody', payload: { style: 'simple' } },
    },
    {
        id: 'generate-chords',
        label: 'Generate Chords',
        description: 'Create a chord progression on a MIDI track',
        category: 'AI',
        action: { type: 'generateChordProgression', payload: { style: 'pop' } },
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
    },
    {
        id: 'load-rave-vocals',
        label: 'Load RAVE: Vocals',
        description: 'Load the vocal synthesis neural model',
        category: 'AI',
        action: { type: 'loadRaveModel', payload: { modelId: 'rave-vocals' } },
    },
];
