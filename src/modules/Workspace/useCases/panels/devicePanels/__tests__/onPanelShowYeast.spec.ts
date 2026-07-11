import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowYeast = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowYeast';
describe('export const onPanelShowYeast = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowYeast = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
