import { type DrumEngineType } from '../models/ToasterKit';

/**
 * Map TS engine type to Rust DrumEngineType index.
 * Must match toaster/src/pad.rs set_param("engine_type") match arms.
 *
 * Indices 0-12: generic/legacy engines
 * Indices 13-28: circuit-faithful engines (808/909/CR-78)
 *
 * Lives in its own file rather than beside the preset loader because the loader
 * now consumes `projectToasterKitToEngineMessages`, and the projection needs this
 * map — keeping the map in the loader would close an import cycle between them.
 */
export const TOASTER_ENGINE_MAP: Record<DrumEngineType, number> = {
    // Circuit-faithful 808 (indices 13-26)
    'kick-808': 13,
    'snare-808': 15,
    'hihat-closed': 16,
    'hihat-open': 16,
    clap: 18,
    cowbell: 23,
    clave: 24,
    rimshot: 25,
    maracas: 26,
    'tom-808-low': 20,
    'tom-808-mid': 21,
    'tom-808-high': 22,
    // Circuit-faithful 909 (indices 14, 17, 19)
    'kick-909': 14,
    'clap-909': 19,
    'hihat-909': 17,
    // CR-78 (indices 27-28)
    'cr78-drum': 27,
    'cr78-metallic': 28,
    // Generic / analog voices (indices 0-12)
    'kick-analog': 0,
    'snare-analog': 1,
    tom: 5,
    cymbal: 6,
    shaker: 11,
    'perc-generic': 4,
    // Melodic / textural
    'modal-tabla': 7,
    'modal-bongo': 7,
    'modal-woodblock': 7,
    'modal-metal': 7,
    'fm-perc': 8,
    sample: 4,
};
