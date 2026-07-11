import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowFermenter = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowFermenter';
describe('export const onPanelShowFermenter = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowFermenter = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
