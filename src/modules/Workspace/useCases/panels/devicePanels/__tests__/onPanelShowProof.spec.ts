import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowProof = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowProof';
describe('export const onPanelShowProof = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowProof = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
