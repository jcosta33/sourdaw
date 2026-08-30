import { projectSessionQuiescer } from './projectSessionQuiescer';

/** Reopens plugin lifecycle admission only after the renderer window is gone. */
export function releaseProjectSessionPluginRetirement(): void {
    projectSessionQuiescer.releaseAfterWindowDestroy();
}
