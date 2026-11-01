import { executeAppAction } from '#/modules/Command/useCases';

export function removeTempoChange(changeId: string): Promise<void> {
    return executeAppAction({ type: 'editTempoMap', payload: { edit: { type: 'remove', id: changeId } } });
}
