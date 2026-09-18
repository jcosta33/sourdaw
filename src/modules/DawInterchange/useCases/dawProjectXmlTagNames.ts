/**
 * Element vocabulary of the two XML documents inside a `.dawproject` archive
 * (`project.xml`, `metadata.xml`). The serializers (`serializeProjectXml.ts`,
 * `serializeMetadataXml.ts`) and the parsers (`parseProjectXml.ts`,
 * `parseMetadataXml.ts`) author the same tag names; a tag renamed on one side
 * is silently skipped by the other, so every name both sides share is spelled
 * once here.
 *
 * Reader-only leniency alternates for foreign files — `<Warps>` wrapping an
 * `<Audio>`, and `<Automation>` as a sibling of `<Points>` — stay inline at
 * their read site: our writer never emits them, so they are not a
 * writer↔reader agreement this map could pin. Attribute names (`value`,
 * `time`, `name`, …) are shared with the DAWproject spec's generic attribute
 * set and stay inline with the tag they belong to.
 */
export const DAW_PROJECT_XML_TAGS = {
    PROJECT: 'Project',
    APPLICATION: 'Application',
    TRANSPORT: 'Transport',
    TEMPO: 'Tempo',
    TIME_SIGNATURE: 'TimeSignature',
    STRUCTURE: 'Structure',
    TRACK: 'Track',
    CHANNEL: 'Channel',
    VOLUME: 'Volume',
    PAN: 'Pan',
    MUTE: 'Mute',
    SOLO: 'Solo',
    DEVICES: 'Devices',
    DEVICE: 'Device',
    ARRANGEMENT: 'Arrangement',
    LANES: 'Lanes',
    CLIPS: 'Clips',
    CLIP: 'Clip',
    NOTES: 'Notes',
    NOTE: 'Note',
    AUDIO: 'Audio',
    FILE: 'File',
    POINTS: 'Points',
    REAL_POINT: 'RealPoint',
    TIME_SIGNATURE_POINT: 'TimeSignaturePoint',
    MARKERS: 'Markers',
    MARKER: 'Marker',
    META_DATA: 'MetaData',
    TITLE: 'Title',
    ARTIST: 'Artist',
    COMMENT: 'Comment',
} as const;
