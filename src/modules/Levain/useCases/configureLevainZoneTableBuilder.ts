import { type LevainZoneTableBuilder } from '../repositories/sampleLoader/loadInstrumentFromManifest';

let configuredBuilder: LevainZoneTableBuilder | null = null;

/**
 * Binds the builder that computes a bank's zone tables off the render thread.
 * The composition root passes AudioEngine's, so Levain takes the Worker as an
 * injected collaborator rather than importing AudioEngine's use case itself.
 */
export function configureLevainZoneTableBuilder(builder: LevainZoneTableBuilder | null): void {
    configuredBuilder = builder;
}

const buildWithConfiguredBuilder: LevainZoneTableBuilder = (request, signal) => {
    if (configuredBuilder === null) {
        return Promise.reject(new Error('Levain zone table builder is not configured'));
    }
    return configuredBuilder(request, signal);
};

/**
 * The builder every bank load hands the loader. With none configured the load
 * rejects: the render thread never computes the tables, so there is nothing to
 * fall back to.
 */
export const configuredLevainZoneTableBuilder = { build: buildWithConfiguredBuilder };
