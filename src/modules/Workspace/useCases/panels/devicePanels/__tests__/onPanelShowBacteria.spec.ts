import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowBacteria = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowBacteria';
describe('export const onPanelShowBacteria = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowBacteria = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
