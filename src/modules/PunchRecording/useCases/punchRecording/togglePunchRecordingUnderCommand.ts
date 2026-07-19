import { type LegacyCommandMutationRunner } from '#/utils/handlerContract';

import { commitTogglePunchRecording } from './commitTogglePunchRecording';

export function togglePunchRecordingUnderCommand(runLegacyCommandMutation: LegacyCommandMutationRunner): Promise<void> {
    return runLegacyCommandMutation(commitTogglePunchRecording);
}
