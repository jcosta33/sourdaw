import { inject } from '#/infra/di/inject';
import { executeAppAction } from '#/modules/Command/useCases';

/**
 * Remove one learned MIDI mapping by id (F-10).
 *
 * Dispatches `removeMidiMapping` through `executeAppAction` (audit A-1): a
 * mapping references project entities (`trackId`/`deviceId`/`paramId`), so
 * removing one is a project-truth edit like removing any other track/device
 * binding — transacted and undoable. The actual mutation lives in
 * `handleRemoveMidiMapping`
 * (`handlers/midiLearn/handleRestoreMidiLearnMappings.ts`), including the
 * "mapping doesn't exist" no-op check.
 */
export const removeMapping = inject({ executeAppAction })(
    ({ executeAppAction }) =>
        function removeMapping(mappingId: string): void {
            void executeAppAction({ type: 'removeMidiMapping', payload: { mappingId } });
        }
);
