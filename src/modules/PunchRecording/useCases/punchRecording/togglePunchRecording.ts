import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { commitTogglePunchRecording } from './commitTogglePunchRecording';

export function togglePunchRecording(): void {
    void runLegacyCommandMutation(commitTogglePunchRecording);
}
