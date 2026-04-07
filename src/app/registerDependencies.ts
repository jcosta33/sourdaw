import { createEventBus } from '#/infra/events/createEventBus';
import { logger } from '#/infra/logger/appLogger';

import { type TrackAddedPayload } from '#/modules/Arrangement/events/TrackAddedEvent';
import { type TrackRemovedPayload } from '#/modules/Arrangement/events/TrackRemovedEvent';
import { type AudioDeviceLoadedPayload } from '#/modules/AudioEngine/events/AudioDeviceLoadedEvent';
import {
    type ShowDevicePanelPayload,
    type VoidPayload,
    type NotifyPayload,
    type ZoomToSelectionPayload,
    type ToggleVoiceCommandPayload,
    type ImportMidiPayload,
    type MidiOutPayload,
    type MidiNoteOnPayload,
    type MidiNoteOffPayload,
    type MidiPedalCcPayload,
} from '#/modules/Workspace/events/WorkspaceEvents';

export type AppEvents = {
    // Domain events
    'track.added': TrackAddedPayload;
    'track.removed': TrackRemovedPayload;
    'audioDevice.loaded': AudioDeviceLoadedPayload;

    // Panel toggles
    'panel.showFermenter': ShowDevicePanelPayload;
    'panel.showToaster': ShowDevicePanelPayload;
    'panel.showLevain': ShowDevicePanelPayload;
    'panel.showDutchOven': ShowDevicePanelPayload;
    'panel.showGluten': ShowDevicePanelPayload;
    'panel.showBacteria': ShowDevicePanelPayload;
    'panel.showGrinder': ShowDevicePanelPayload;
    'panel.showProof': ShowDevicePanelPayload;
    'panel.showYeast': ShowDevicePanelPayload;
    'panel.showScoring': ShowDevicePanelPayload;
    'panel.showCrust': ShowDevicePanelPayload;
    'panel.showCrumbs': ShowDevicePanelPayload;
    'panel.showGrandBoule': ShowDevicePanelPayload;
    'panel.showAutomation': VoidPayload;

    // Dialog triggers
    'dialog.openExport': VoidPayload;
    'dialog.openPreferences': VoidPayload;

    // Project actions
    'project.save': VoidPayload;
    'project.new': VoidPayload;
    'command.undo': VoidPayload;
    'command.redo': VoidPayload;

    // MIDI
    'midi.import': ImportMidiPayload;
    'midi.out': MidiOutPayload;
    'midi.noteOn': MidiNoteOnPayload;
    'midi.noteOff': MidiNoteOffPayload;
    'midi.pedalCc': MidiPedalCcPayload;

    // Timeline / zoom
    'zoom.toFit': VoidPayload;
    'zoom.toSelection': ZoomToSelectionPayload;
    'zoom.scrollToPlayhead': VoidPayload;

    // Voice command
    'voice.toggle': ToggleVoiceCommandPayload;

    // Notifications
    'ui.notify': NotifyPayload;

    // Shortcut engine
    'shortcut.fired': { action: string };
};

export const eventBus = createEventBus<AppEvents>();

export { logger };
