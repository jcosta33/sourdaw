import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { clearSolos } from '#/modules/Arrangement/useCases/toggleTrackState/clearSolos';
import type { ExtractAction } from '../types';

const executeClearSolos = inject({ clearSolos })(
    ({ clearSolos }) =>
        function executeClearSolos(_action: ExtractAction<AppAction, 'clearSolos'>): void {
            clearSolos();
        }
);

export const handleClearSolos = createHandler<'clearSolos'>({
    execute: executeClearSolos,
    describe: () => ({ label: 'Clear all solos' }),
    undoable: true,
});
