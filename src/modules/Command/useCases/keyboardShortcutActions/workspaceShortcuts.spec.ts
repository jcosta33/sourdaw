import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { zoomToFit } from './workspaceShortcuts/zoomToFit';

const noop = (): void => {};

describe('workspaceShortcuts', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('zoomToFit delegates to the injected implementation', () => {
        const zoomToFitImpl = vi.fn();
        injectDependencies(zoomToFit, {
            setEditingTool: noop as never,
            zoomToFit: zoomToFitImpl,
            zoomToSelection: noop as never,
        });

        zoomToFit();

        expect(zoomToFitImpl).toHaveBeenCalledTimes(1);
    });
});
