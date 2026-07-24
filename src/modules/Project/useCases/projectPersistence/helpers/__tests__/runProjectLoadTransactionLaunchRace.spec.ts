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
    dependencies.setProjectIdentityTransitionDependencies({
        leaveCollaborationSession: () => Promise.resolve(),
    });
    return machinery;
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
});
