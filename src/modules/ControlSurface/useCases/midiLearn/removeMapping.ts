import { inject } from '#/infra/di/inject';
import { executeUserAppAction } from '#/modules/Command/useCases';

/**
 * Remove one learned MIDI mapping by id (F-10).
 *
 * Dispatches `removeMidiMapping` through `executeUserAppAction` (audit A-1): a
 * mapping references project entities (`trackId`/`deviceId`/`paramId`), so
 * removing one is a project-truth edit like removing any other track/device
 * binding — transacted and undoable. The actual mutation lives in
 * `handleRemoveMidiMapping`
 * (`handlers/midiLearn/handleRestoreMidiLearnMappings.ts`), including the
 * "mapping doesn't exist" no-op check.
 */
export const removeMapping = inject({ executeUserAppAction })(
    ({ executeUserAppAction }) =>
        function removeMapping(mappingId: string): void {
            void executeUserAppAction({ type: 'removeMidiMapping', payload: { mappingId } });
        }
);
