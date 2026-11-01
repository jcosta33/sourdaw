import { executeAppAction } from '#/modules/Command/useCases';

import { type TempoChange } from '../../models/TempoMap';

export function addTempoChange(beat: number, tempo: number, curve: TempoChange['curve'] = 'instant'): Promise<void> {
    return executeAppAction({ type: 'editTempoMap', payload: { edit: { type: 'add', beat, tempo, curve } } });
}
