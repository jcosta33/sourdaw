import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowCrumbs = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowCrumbs';
describe('export const onPanelShowCrumbs = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowCrumbs = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
