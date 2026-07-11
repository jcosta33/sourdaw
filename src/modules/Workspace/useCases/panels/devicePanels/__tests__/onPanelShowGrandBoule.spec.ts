import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowGrandBoule = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowGrandBoule';
describe('export const onPanelShowGrandBoule = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowGrandBoule = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
