import { runLegacyCommandMutationUnderOwner } from '#/modules/Command/useCases';

import { commitTogglePunchRecording } from './commitTogglePunchRecording';

export function togglePunchRecordingUnderCommand(): void {
    void runLegacyCommandMutationUnderOwner(commitTogglePunchRecording);
}
