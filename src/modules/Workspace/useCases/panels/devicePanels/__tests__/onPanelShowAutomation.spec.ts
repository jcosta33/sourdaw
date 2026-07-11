import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowAutomation = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowAutomation';
describe('export const onPanelShowAutomation = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowAutomation = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
