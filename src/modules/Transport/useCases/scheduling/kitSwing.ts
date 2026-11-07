/** The swing a drum kit device plays at, as its module holds it live. */
type KitSwing = {
    /**
     * The kit's current swing, or `undefined` when the module holds no live
     * state for the device; the caller then falls back to the stored value.
     */
    currentSwing: (deviceId: string) => number | undefined;
};

let registeredKitSwing: KitSwing | null = null;

/**
 * Transport may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can start playback.
 */
export const kitSwing = {
    /**
     * Registering the identical reader again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(swing: KitSwing): void {
        if (registeredKitSwing === null) {
            registeredKitSwing = swing;
            return;
        }
        if (registeredKitSwing.currentSwing !== swing.currentSwing) {
            throw new Error('kitSwing.configure: the kit swing reader differs from the registered one');
        }
    },
    /**
     * The registered reader. Reading before registration throws rather than
     * answering `undefined`: an empty reader would silently play every kit at
     * its stored swing instead of the one the musician is dialling.
     */
    read(caller: string): KitSwing {
        if (registeredKitSwing === null) {
            throw new Error(
                `${caller}: kit swing is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredKitSwing;
    },
};
