/** Where a neural amp device's selected model comes from, as its module resolves it. */
type NeuralModelContent = {
    /**
     * The model file the device's stored values select, or `undefined` when
     * they select none the module's library holds.
     */
    modelContent: (parameterValues: Readonly<Record<string, unknown>>) => string | undefined;
};

let registeredContent: NeuralModelContent | null = null;

/**
 * AudioEngine may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can build a native body.
 */
export const neuralModelContent = {
    /**
     * Registering the identical resolver again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(content: NeuralModelContent): void {
        if (registeredContent === null) {
            registeredContent = content;
            return;
        }
        if (registeredContent.modelContent !== content.modelContent) {
            throw new Error('neuralModelContent.configure: the resolver differs from the registered one');
        }
    },
    /**
     * The registered resolver. Reading before registration throws rather than
     * answering `undefined`: that would send the native body no model while
     * the musician has one loaded.
     */
    read(caller: string): NeuralModelContent {
        if (registeredContent === null) {
            throw new Error(
                `${caller}: neural model content is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredContent;
    },
};
