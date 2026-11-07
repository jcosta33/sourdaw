import { type TransportState } from '../models/TransportState';
import { transportStore } from '../stores/transportStore';

import { preferencesSeededTransportState } from './preferencesSeededTransportState';

/**
 * Replace the whole transport with the state a new project starts from: the
 * Recording preferences seed its count-in and pre-roll, and a template or demo
 * passes the values it builds on top of that seed. A loaded project restores
 * its own saved transport values through `restoreTransportSnapshot`, which
 * never passes here.
 */
export function seedTransportForNewProject(overrides: Partial<TransportState> = {}): void {
    transportStore.set({ ...preferencesSeededTransportState(), ...overrides });
}
