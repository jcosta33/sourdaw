/**
 * The rack write path a template uses to configure an arpeggiator: the same
 * writes the rack's own panel dispatches, owned by the rack's module.
 */
type TemplateArpeggiatorAuthoring = {
    /** Pin the device whose rack the following writes land in; `null` unpins. */
    focusRack: (deviceId: string | null) => void;
    /** Add a processor to the pinned rack under the given id and name. */
    addProcessor: (type: 'arpeggiator', processorId: string, name: string) => void;
    /** Set one of the processor's own parameters on the pinned rack. */
    setProcessorParam: (processorId: string, name: string, value: number) => Promise<void>;
};

let registeredAuthoring: TemplateArpeggiatorAuthoring | null = null;

function authoringDiffers(current: TemplateArpeggiatorAuthoring, next: TemplateArpeggiatorAuthoring): boolean {
    return (
        current.focusRack !== next.focusRack ||
        current.addProcessor !== next.addProcessor ||
        current.setProcessorParam !== next.setProcessorParam
    );
}

/**
 * Project may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can create a project from a template.
 */
export const templateArpeggiatorAuthoring = {
    /**
     * Registering the identical write path again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(authoring: TemplateArpeggiatorAuthoring): void {
        if (registeredAuthoring === null) {
            registeredAuthoring = authoring;
            return;
        }
        if (authoringDiffers(registeredAuthoring, authoring)) {
            throw new Error('templateArpeggiatorAuthoring.configure: the write path differs from the registered one');
        }
    },
    /**
     * The registered write path. Reading before registration throws rather
     * than skipping the writes: the template would then open with an empty
     * rack where its arpeggiator belongs.
     */
    read(caller: string): TemplateArpeggiatorAuthoring {
        if (registeredAuthoring === null) {
            throw new Error(
                `${caller}: template arpeggiator authoring is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredAuthoring;
    },
};
