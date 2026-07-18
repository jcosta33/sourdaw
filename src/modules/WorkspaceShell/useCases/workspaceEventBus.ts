import { Container } from '#/infra/di/Container';

import type {
    ConfirmPayload,
    ImportMidiPayload,
    MidiOutPayload,
    NotifyPayload,
    PromptPayload,
    ShowDevicePanelGenericPayload,
    ShowDevicePanelPayload,
    ToggleVoiceCommandPayload,
    VoidPayload,
    ZoomToSelectionPayload,
} from '../events/WorkspaceEvents';

type WorkspaceEvents = {
    'panel.showDevice': ShowDevicePanelGenericPayload;
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
    'dialog.openExport': VoidPayload;
    'dialog.openPreferences': VoidPayload;
    'project.save': VoidPayload;
    'project.new': VoidPayload;
    'command.undo': VoidPayload;
    'command.redo': VoidPayload;
    'midi.import': ImportMidiPayload;
    'midi.out': MidiOutPayload;
    'zoom.toFit': VoidPayload;
    'zoom.toSelection': ZoomToSelectionPayload;
    'zoom.scrollToPlayhead': VoidPayload;
    'voice.toggle': ToggleVoiceCommandPayload;
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

export abstract class WorkspaceEventBus {
    abstract emit<TEventName extends keyof WorkspaceEvents>(
        event: TEventName,
        payload: WorkspaceEvents[TEventName]
    ): Promise<void>;
    abstract on<TEventName extends keyof WorkspaceEvents>(
        event: TEventName,
        handler: (payload: WorkspaceEvents[TEventName]) => void | Promise<void>
    ): () => void;
}

export function setWorkspaceEventBus(event_bus: WorkspaceEventBus): void {
    Container.set(WorkspaceEventBus, event_bus);
}
