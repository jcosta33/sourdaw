/** What the command palette's tour command starts. */
type OnboardingTourLauncher = {
    /** Starts the guided onboarding tour from its first step. */
    startTour: () => void;
};

let registeredLauncher: OnboardingTourLauncher | null = null;

/**
 * CommandInterface may not import Onboarding, a shell module above it, so the
 * composition root (`#/app/registerSupportingServicePorts`) fills this once at
 * boot, before the palette can run a command.
 */
export const onboardingTourLauncher = {
    /**
     * Registering the identical launcher again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(launcher: OnboardingTourLauncher): void {
        if (registeredLauncher === null) {
            registeredLauncher = launcher;
            return;
        }
        if (registeredLauncher.startTour !== launcher.startTour) {
            throw new Error('onboardingTourLauncher.configure: the launcher differs from the registered one');
        }
    },
    /**
     * The registered launcher. Reading before registration throws rather
     * than doing nothing: the palette command would then silently start no
     * tour.
     */
    read(caller: string): OnboardingTourLauncher {
        if (registeredLauncher === null) {
            throw new Error(
                `${caller}: the onboarding tour launcher is not registered; call registerSupportingServicePorts() from #/app/registerSupportingServicePorts (bootstrap does this)`
            );
        }
        return registeredLauncher;
    },
};
