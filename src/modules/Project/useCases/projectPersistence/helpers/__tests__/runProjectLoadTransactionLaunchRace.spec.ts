import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/modules/AudioEngine/useCases', () => ({ cancelPendingAudioBufferImport: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ resetActionReplayAuthority: vi.fn() }));

// Deterministic reproduction of the wave-1 e2e launch race (#716).
//
// useAppInitialization awaits `initializeAudioEngine()` before it calls the boot
// restore `loadProject()`. The LaunchScreen is interactive the whole time, so a
// user can pick a template while that slow init is still resolving. The template
// transition is created first (lower id) and starts preparing; the boot restore
// transition is created second (higher id). Under the plain "last-created wins"
// rule the boot transition would supersede the user's explicit choice, its
// prepare/activate would report the template as no longer current, and
// createFromTemplate would bail with "transition rejected" — dropping the user
// on an empty "Untitled Project". `yieldToInFlight` makes the boot restore stand
// down instead.
//
// Module-level transition counters are singletons, so each test isolates them
// with vi.resetModules() + a fresh dynamic import.
async function loadFreshMachinery() {
    vi.resetModules();
    const machinery = await import('../runProjectLoadTransaction');
    const dependencies = await import('../../projectIdentityTransitionDependencies');
    const command = await import('#/modules/Command/useCases');
    dependencies.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    return {
        runProjectLoadTransaction: machinery.runProjectLoadTransaction,
        resetActionReplayAuthorityMock: vi.mocked(command.resetActionReplayAuthority),
    };
}

describe('runProjectLoadTransaction — launch race', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not let a boot restore created mid-flight supersede the user template transition', async () => {
        const { runProjectLoadTransaction } = await loadFreshMachinery();

        // User clicks a template first: its transition is created and begins
        // preparing (it synchronously claims the latest-prepared slot).
        const template = runProjectLoadTransaction();
        const templatePrepare = template.prepare();

        // Slow initializeAudioEngine finally resolves and the boot restore runs,
        // creating its transition with a higher id.
        const boot = runProjectLoadTransaction({ yieldToInFlight: true });
        const bootPrepared = await boot.prepare();
        const templatePrepared = await templatePrepare;

        // The boot restore yields; the user's explicit choice wins.
        expect(bootPrepared).toBe(false);
        expect(templatePrepared).toBe(true);
        expect(boot.activate()).toBe(false);
        expect(template.activate()).toBe(true);
        expect(template.isCurrent()).toBe(true);
    });

    it('does not let a boot restore supersede a completed user template transition', async () => {
        const { runProjectLoadTransaction } = await loadFreshMachinery();

        const template = runProjectLoadTransaction();
        await expect(template.prepare()).resolves.toBe(true);
        expect(template.activate()).toBe(true);

        const boot = runProjectLoadTransaction({ yieldToInFlight: true });

        await expect(boot.prepare()).resolves.toBe(false);
        expect(boot.activate()).toBe(false);
        expect(template.isCurrent()).toBe(true);
    });

    it('lets the boot restore proceed when no user transition is in flight', async () => {
        const { runProjectLoadTransaction } = await loadFreshMachinery();

        const boot = runProjectLoadTransaction({ yieldToInFlight: true });

        await expect(boot.prepare()).resolves.toBe(true);
        expect(boot.activate()).toBe(true);
        expect(boot.isCurrent()).toBe(true);
    });

    it('still lets a later user transition supersede a completed boot restore', async () => {
        const { runProjectLoadTransaction } = await loadFreshMachinery();

        const boot = runProjectLoadTransaction({ yieldToInFlight: true });
        await boot.prepare();
        expect(boot.activate()).toBe(true);

        const user = runProjectLoadTransaction();
        await expect(user.prepare()).resolves.toBe(true);
        expect(user.activate()).toBe(true);
        expect(user.isCurrent()).toBe(true);
        expect(boot.isCurrent()).toBe(false);
    });

    it('lets a later user template supersede a boot restore that is still mid-flight', async () => {
        // The pre-fix working case, kept pinned: the boot restore commits to
        // preparing first, then the user picks a template. The template is created
        // later (higher id) and wins by the normal last-wins rule; the boot restore
        // observes it was superseded during its own await and stands down.
        const { runProjectLoadTransaction } = await loadFreshMachinery();

        const boot = runProjectLoadTransaction({ yieldToInFlight: true });
        const bootPrepare = boot.prepare();
        const template = runProjectLoadTransaction();
        const templatePrepare = template.prepare();
        const bootPrepared = await bootPrepare;
        const templatePrepared = await templatePrepare;

        expect(bootPrepared).toBe(false);
        expect(templatePrepared).toBe(true);
        expect(boot.activate()).toBe(false);
        expect(template.activate()).toBe(true);
        expect(template.isCurrent()).toBe(true);
    });

    it('releases the in-flight count when prepare throws before the await, so a later boot restore still proceeds', async () => {
        // Throw from resetActionReplayAuthority — the synchronous prepare-side step
        // that now sits inside the guarded region. Before the guard covered it, this
        // throw leaked the in-flight count and every future yielding boot restore
        // stood down forever. The catch must decrement so the count self-heals: the
        // subsequent yielding boot restore proceeds instead of yielding.
        const { runProjectLoadTransaction, resetActionReplayAuthorityMock } = await loadFreshMachinery();

        resetActionReplayAuthorityMock.mockImplementationOnce(() => {
            throw new Error('replay authority reset failed');
        });
        const failing = runProjectLoadTransaction();
        await expect(failing.prepare()).rejects.toThrow('replay authority reset failed');

        const boot = runProjectLoadTransaction({ yieldToInFlight: true });
        await expect(boot.prepare()).resolves.toBe(true);
        expect(boot.activate()).toBe(true);
        expect(boot.isCurrent()).toBe(true);
    });
});
