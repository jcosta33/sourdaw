import { beforeEach, describe, expect, it } from 'vitest';

import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultTrackState,
    trackStore,
} from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';

import { aiCommands } from '../commands/AiCommands';
import { automationCommands } from '../commands/AutomationCommands';
import { clipCommands } from '../commands/ClipCommands';
import { elasticCommands } from '../commands/ElasticCommands';
import { midiCommands } from '../commands/MidiCommands';
import { getCommandContext } from '../getCommandContext';
import { getCommandInapplicabilityReason } from '../getCommandInapplicabilityReason';

const midiContext = {
    selectedClipId: 'midi',
    selectedClipIds: ['midi', 'other'],
    selectedClipType: 'midi' as const,
    hasAutomationLane: true,
};
const audioContext = { ...midiContext, selectedClipType: 'audio' as const };

describe('palette context snapshots', () => {
    beforeEach(() => {
        trackStore.set(defaultTrackState);
        clipSelectionStore.set(defaultClipSelectionState);
        automationStore.set({ lanes: [] });
    });

    it('uses explicit snapshots rather than the current stores and preserves primary selection precedence', () => {
        const context = getCommandContext({
            tracks: defaultTrackState,
            selection: {
                ...defaultClipSelectionState,
                selectedClipId: 'fallback',
                selectedClipIds: ['first', 'second'],
            },
            automation: { lanes: [] },
        });
        expect(context).toEqual({
            selectedClipId: 'first',
            selectedClipIds: ['first', 'second'],
            selectedClipType: null,
            hasAutomationLane: false,
        });
        expect(getCommandContext()).toEqual({
            selectedClipId: null,
            selectedClipIds: [],
            selectedClipType: null,
            hasAutomationLane: false,
        });
    });

    it.each([...midiCommands, ...aiCommands].filter((command) => command.getInapplicabilityReason))(
        '$label uses the supplied MIDI context and rereads live context for execution',
        (command) => {
            expect(getCommandInapplicabilityReason(command, midiContext)).toBeNull();
            expect(getCommandInapplicabilityReason(command, audioContext)).toBe('Select a MIDI clip first.');
            expect(getCommandInapplicabilityReason(command)).toBe('Select a MIDI clip first.');
        }
    );

    it.each([...clipCommands, ...elasticCommands].filter((command) => command.getInapplicabilityReason))(
        '$label uses the supplied clip context without authorizing live execution',
        (command) => {
            expect(getCommandInapplicabilityReason(command, audioContext)).toBeNull();
            expect(getCommandInapplicabilityReason(command)).not.toBeNull();
        }
    );

    it.each(automationCommands)(
        '$label uses the supplied automation context and rereads live lanes for execution',
        (command) => {
            expect(getCommandInapplicabilityReason(command, midiContext)).toBeNull();
            expect(getCommandInapplicabilityReason(command)).toBe('Create an automation lane first.');
        }
    );
});
