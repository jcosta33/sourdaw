import type { setDeviceState } from '#/modules/Arrangement/useCases';

type StringSectionInstrument = 'violin-1' | 'violin-2' | 'viola' | 'cello' | 'double-bass';

type DeviceState = Parameters<typeof setDeviceState>[0]['state'];

/** The device content templates and demo projects seed their devices with. */
type TemplateDeviceContent = {
    /** The stored state of a string-section instrument set to the section's default patch. */
    stringSectionState: (instrumentId: StringSectionInstrument) => DeviceState;
    /** A fresh copy of the drum kit's default pad names, in pad order. */
    defaultPadNames: () => string[];
};

let registeredContent: TemplateDeviceContent | null = null;

function contentDiffers(current: TemplateDeviceContent, next: TemplateDeviceContent): boolean {
    return current.stringSectionState !== next.stringSectionState || current.defaultPadNames !== next.defaultPadNames;
}

/**
 * Project may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can create a template or demo project.
 */
export const templateDeviceContent = {
    /**
     * Registering the identical content again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(content: TemplateDeviceContent): void {
        if (registeredContent === null) {
            registeredContent = content;
            return;
        }
        if (contentDiffers(registeredContent, content)) {
            throw new Error('templateDeviceContent.configure: the content differs from the registered one');
        }
    },
    /**
     * The registered content. Reading before registration throws rather than
     * answering empty content: a template would then open with devices that
     * carry none of their section's sound or pad names.
     */
    read(caller: string): TemplateDeviceContent {
        if (registeredContent === null) {
            throw new Error(
                `${caller}: template device content is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredContent;
    },
};
