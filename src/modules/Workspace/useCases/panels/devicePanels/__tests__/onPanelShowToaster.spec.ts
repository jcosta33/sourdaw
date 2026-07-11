import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowToaster = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowToaster';
describe('export const onPanelShowToaster = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowToaster = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
