import { executeAppAction } from '#/modules/Command/useCases';

export function updateTempoChange(changeId: string, tempo: number): Promise<void> {
    return executeAppAction({ type: 'editTempoMap', payload: { edit: { type: 'update', id: changeId, tempo } } });
}
