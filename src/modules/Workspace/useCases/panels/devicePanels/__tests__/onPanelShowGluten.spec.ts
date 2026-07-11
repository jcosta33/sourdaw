import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowGluten = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowGluten';
describe('export const onPanelShowGluten = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowGluten = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
