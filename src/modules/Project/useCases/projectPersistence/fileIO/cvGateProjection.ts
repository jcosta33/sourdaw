import { type ProjectCvGate } from '../../../models/ProjectData';

/** Where a save reads the CV/gate output state it writes into the file. */
type CvGateProjection = {
    /**
     * The live CV/gate state, or `null` when there is none. The module's own
     * object: the save clones it before it enters the file.
     */
    readCvGate: () => ProjectCvGate | null;
};

let registeredProjection: CvGateProjection | null = null;

/**
 * Project may not import CvGate, which owns the CV/gate outputs, so the
 * composition root (`#/app/registerSupportingServicePorts`) fills this once at
 * boot, before anything can save a project.
 */
export const cvGateProjection = {
    /**
     * Registering the identical projection again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(projection: CvGateProjection): void {
        if (registeredProjection === null) {
            registeredProjection = projection;
            return;
        }
        if (registeredProjection.readCvGate !== projection.readCvGate) {
            throw new Error('cvGateProjection.configure: the projection differs from the registered one');
        }
    },
    /**
     * The registered projection. Reading before registration throws rather
     * than answering no state: a save would then silently drop every CV/gate
     * output the musician added.
     */
    read(caller: string): CvGateProjection {
        if (registeredProjection === null) {
            throw new Error(
                `${caller}: the CV/gate projection is not registered; call registerSupportingServicePorts() from #/app/registerSupportingServicePorts (bootstrap does this)`
            );
        }
        return registeredProjection;
    },
};
