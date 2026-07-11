import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowScoring = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowScoring';
describe('export const onPanelShowScoring = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowScoring = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
