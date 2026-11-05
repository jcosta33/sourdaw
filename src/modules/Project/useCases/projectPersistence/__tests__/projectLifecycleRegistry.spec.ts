import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';

import { type HydratableProjectData } from '../helpers/isHydratableProjectData';
import { projectLifecycleRegistry } from '../projectLifecycleRegistry';

const UNREGISTERED_FIX =
    'project lifecycle participants are not registered; call registerProjectLifecycle() from #/app/registerProjectLifecycle (bootstrap does this)';

/**
 * Project cannot import the modules a project switch resets, so the
 * composition root registers them. The registry is module state: a case that
 * needs it empty starts from freshly evaluated modules.
 */
function startFromFreshModules(): void {
    beforeEach(() => {
        vi.resetModules();
    });
}

function createProjectData(): HydratableProjectData {
    return {
        version: 1,
        meta: {
            name: 'Project',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 0,
            scaleName: 'Major',
            tuning: { name: 'Equal temperament', frequencies: [] },
        },
        arrangement: { tracks: [] },
    };
}

describe('project lifecycle registry before registration', () => {
    startFromFreshModules();

    it('refuses a reset instead of leaving the outgoing project in every module', async () => {
        const { resetModuleStoresToDefault } = await import('../helpers/resetModuleStoresToDefault');

        expect(() => resetModuleStoresToDefault()).toThrow(`resetModuleStoresToDefault: ${UNREGISTERED_FIX}`);
    });

    it('refuses a hydrate instead of hydrating nothing', async () => {
        const { hydrateModuleStoresFromProjectData } = await import('../helpers/hydrateModuleStoresFromProjectData');

        expect(() => hydrateModuleStoresFromProjectData(createProjectData())).toThrow(
            `hydrateModuleStoresFromProjectData: ${UNREGISTERED_FIX}`
        );
    });
});

describe('production project lifecycle registration', () => {
    it('accepts the production registration again, in the same order', () => {
        registerProjectLifecycle();
        const first = projectLifecycleRegistry.read('spec');
        registerProjectLifecycle();

        expect(projectLifecycleRegistry.read('spec')).toEqual(first);
    });
});

describe('project lifecycle registration', () => {
    startFromFreshModules();

    it('runs each phase through the registered participants, in order', async () => {
        const { projectLifecycleRegistry: registry } = await import('../projectLifecycleRegistry');
        const { resetModuleStoresToDefault } = await import('../helpers/resetModuleStoresToDefault');
        const { hydrateModuleStoresFromProjectData } = await import('../helpers/hydrateModuleStoresFromProjectData');
        const calls: string[] = [];
        registry.configure([
            { module: 'First', resetForProject: (options) => calls.push(`reset First ${JSON.stringify(options)}`) },
            { module: 'Second', hydrateFromProjectData: (data) => calls.push(`hydrate Second ${data.meta.name}`) },
            { module: 'First', part: 'later', resetForProject: () => calls.push('reset First later') },
        ]);

        resetModuleStoresToDefault({ resetMidiState: false });
        hydrateModuleStoresFromProjectData(createProjectData());

        expect(calls).toEqual([
            'reset First {"createNewMidiProbabilitySeed":false,"resetGrooveTemplates":true,"resetMidiState":false,"resetYeastState":true}',
            'reset First later',
            'hydrate Second Project',
        ]);
    });

    it('accepts the identical list again as a no-op', async () => {
        const { projectLifecycleRegistry: registry } = await import('../projectLifecycleRegistry');
        const first = { module: 'First', resetForProject: vi.fn() };
        const second = { module: 'Second', hydrateFromProjectData: vi.fn() };
        registry.configure([first, second]);

        expect(() => registry.configure([first, second])).not.toThrow();
        expect(registry.read('spec')).toEqual([first, second]);
    });

    it('refuses a list that names one participant twice', async () => {
        const { projectLifecycleRegistry: registry } = await import('../projectLifecycleRegistry');

        expect(() =>
            registry.configure([
                { module: 'Transport', part: 'timeline maps', resetForProject: vi.fn() },
                { module: 'Transport', part: 'timeline maps', resetForProject: vi.fn() },
            ])
        ).toThrow("projectLifecycleRegistry.configure: participant 'Transport (timeline maps)' is registered twice");
        expect(() => registry.read('spec')).toThrow(`spec: ${UNREGISTERED_FIX}`);
    });

    it('refuses a second list that differs from the registered one', async () => {
        const { projectLifecycleRegistry: registry } = await import('../projectLifecycleRegistry');
        const first = { module: 'First', resetForProject: vi.fn() };
        registry.configure([first, { module: 'Second', resetForProject: vi.fn() }]);

        expect(() => registry.configure([first, { module: 'Second', resetForProject: vi.fn() }])).toThrow(
            "projectLifecycleRegistry.configure: participant 'Second' differs from the registered list"
        );
        expect(() => registry.configure([first])).toThrow(
            "projectLifecycleRegistry.configure: participant 'Second' differs from the registered list"
        );
    });
});
