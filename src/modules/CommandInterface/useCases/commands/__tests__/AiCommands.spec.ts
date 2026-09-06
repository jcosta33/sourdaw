import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeUserAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { aiCommands } from '../AiCommands';

vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../../selectionHelpers/getSelectedClipId', () => ({ getSelectedClipId: vi.fn() }));

const REQUIRE_MIDI_CLIP_IDS = [
    'generate-bassline',
    'complete-midi',
    'variation-midi',
    'variation-midi-subtle',
    'variation-midi-wild',
];
const SELECTED_CLIP_IDS = ['detect-tempo', 'detect-key', 'audio-to-midi', 'apply-groove'];

function runAction(id: string): void {
    const command = aiCommands.find((entry) => entry.id === id);
    if (!command || typeof command.action !== 'function') {
        throw new Error(`Expected a callable action for ${id}`);
    }
    command.action();
}

describe('aiCommands', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue('clip-1');
    });

    it('exposes the AI commands under the AI category', () => {
        expect(aiCommands.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category }))).toEqual([
            { id: 'generate-drums', label: 'AI: Generate Drum Pattern', category: 'AI' },
            { id: 'generate-drums-house', label: 'AI: Generate Drums (House)', category: 'AI' },
            { id: 'generate-drums-hiphop', label: 'AI: Generate Drums (Hip-Hop)', category: 'AI' },
            { id: 'generate-melody', label: 'AI: Generate Melody', category: 'AI' },
            { id: 'generate-melody-jazz', label: 'AI: Generate Melody (Jazz)', category: 'AI' },
            { id: 'generate-chords', label: 'AI: Generate Chord Progression', category: 'AI' },
            { id: 'generate-chords-jazz', label: 'AI: Generate Chords (Jazz)', category: 'AI' },
            { id: 'generate-bassline', label: 'AI: Generate Bassline', category: 'AI' },
            { id: 'complete-midi', label: 'AI: Complete MIDI (continue clip)', category: 'AI' },
            { id: 'variation-midi', label: 'AI: Create MIDI Variation', category: 'AI' },
            { id: 'variation-midi-subtle', label: 'AI: Create Subtle MIDI Variation', category: 'AI' },
            { id: 'variation-midi-wild', label: 'AI: Create Wild MIDI Variation', category: 'AI' },
            { id: 'analyze-mix', label: 'Analyze Mix', category: 'AI' },
            { id: 'auto-fix-mix', label: 'Auto-Fix Mix', category: 'AI' },
            { id: 'detect-tempo', label: 'Detect Tempo', category: 'AI' },
            { id: 'detect-key', label: 'Detect Key', category: 'AI' },
            { id: 'audio-to-midi', label: 'Audio to MIDI', category: 'AI' },
            { id: 'apply-groove', label: 'Apply Groove Template', category: 'AI' },
            { id: 'detect-song-structure', label: 'Detect Song Structure', category: 'AI' },
            { id: 'compare-to-reference', label: 'Compare to Reference Mix', category: 'AI' },
            { id: 'generate-all-transitions', label: 'Generate Transition Fills', category: 'AI' },
            { id: 'get-mentor-tips', label: 'Music Mentor Tips', category: 'AI' },
            { id: 'load-rave-strings', label: 'Load RAVE: Strings', category: 'AI' },
            { id: 'load-rave-vocals', label: 'Load RAVE: Vocals', category: 'AI' },
        ]);
    });

    it('the style-preset and one-shot commands are declarative actions with fixed payloads', () => {
        const staticEntries = [
            { id: 'generate-drums', action: { type: 'generateDrumPattern', payload: { style: 'rock' } } },
            { id: 'generate-drums-house', action: { type: 'generateDrumPattern', payload: { style: 'house' } } },
            { id: 'generate-drums-hiphop', action: { type: 'generateDrumPattern', payload: { style: 'hiphop' } } },
            { id: 'generate-melody', action: { type: 'generateMelody', payload: { style: 'simple' } } },
            { id: 'generate-melody-jazz', action: { type: 'generateMelody', payload: { style: 'jazz' } } },
            { id: 'generate-chords', action: { type: 'generateChordProgression', payload: { style: 'pop' } } },
            { id: 'generate-chords-jazz', action: { type: 'generateChordProgression', payload: { style: 'jazz' } } },
            { id: 'analyze-mix', action: { type: 'analyzeMix' } },
            { id: 'auto-fix-mix', action: { type: 'autoFixMix' } },
            { id: 'detect-song-structure', action: { type: 'detectSongStructure', payload: {} } },
            { id: 'compare-to-reference', action: { type: 'compareToReference' } },
            { id: 'generate-all-transitions', action: { type: 'generateAllTransitions' } },
            { id: 'get-mentor-tips', action: { type: 'getMentorTips' } },
            { id: 'load-rave-strings', action: { type: 'loadRaveModel', payload: { modelId: 'rave-strings' } } },
            { id: 'load-rave-vocals', action: { type: 'loadRaveModel', payload: { modelId: 'rave-vocals' } } },
        ];

        for (const { id, action } of staticEntries) {
            const command = aiCommands.find((entry) => entry.id === id);
            expect(command?.action).toEqual(action);
        }
    });

    it('dispatches the correct action for each MIDI-clip-required command when a clip is selected', () => {
        const requireMidiClipEntries = [
            {
                id: 'generate-bassline',
                action: { type: 'generateBassline', payload: { clipId: 'clip-1', style: 'root-fifth' } },
            },
            { id: 'complete-midi', action: { type: 'completeMidi', payload: { clipId: 'clip-1', bars: 4 } } },
            { id: 'variation-midi', action: { type: 'variationMidi', payload: { clipId: 'clip-1', amount: 0.3 } } },
            {
                id: 'variation-midi-subtle',
                action: { type: 'variationMidi', payload: { clipId: 'clip-1', amount: 0.1 } },
            },
            {
                id: 'variation-midi-wild',
                action: { type: 'variationMidi', payload: { clipId: 'clip-1', amount: 0.6 } },
            },
        ];

        for (const { id, action } of requireMidiClipEntries) {
            runAction(id);
            expect(executeUserAppAction).toHaveBeenCalledWith(action);
        }
    });

    it('notifies the user and dispatches nothing for MIDI-clip-required commands when no MIDI clip is selected', async () => {
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue(null);

        for (const id of REQUIRE_MIDI_CLIP_IDS) {
            runAction(id);
        }

        expect(executeUserAppAction).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledTimes(REQUIRE_MIDI_CLIP_IDS.length);
        expect(notifyUser).toHaveBeenCalledWith('Select a MIDI clip first', 'error');
    });

    it('dispatches the correct action for each selected-clip command when a clip is selected', () => {
        const selectedClipEntries = [
            { id: 'detect-tempo', action: { type: 'detectTempo', payload: { clipId: 'clip-1' } } },
            { id: 'detect-key', action: { type: 'detectKey', payload: { clipId: 'clip-1' } } },
            { id: 'audio-to-midi', action: { type: 'audioToMidi', payload: { clipId: 'clip-1' } } },
            {
                id: 'apply-groove',
                action: { type: 'applyGroove', payload: { clipId: 'clip-1', grooveId: 'swing-light' } },
            },
        ];

        for (const { id, action } of selectedClipEntries) {
            runAction(id);
            expect(executeUserAppAction).toHaveBeenCalledWith(action);
        }
    });

    it('dispatches nothing for any selected-clip command when no clip is selected', async () => {
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue(null);

        for (const id of SELECTED_CLIP_IDS) {
            runAction(id);
        }

        expect(executeUserAppAction).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
