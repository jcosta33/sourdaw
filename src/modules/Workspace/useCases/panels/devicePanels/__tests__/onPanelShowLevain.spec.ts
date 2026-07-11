import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowLevain = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowLevain';
describe('export const onPanelShowLevain = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowLevain = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
