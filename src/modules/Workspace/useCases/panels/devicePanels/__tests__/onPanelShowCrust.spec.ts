import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowCrust = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowCrust';
describe('export const onPanelShowCrust = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowCrust = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
