//! One spelling of a VST3 class id, and the one in-memory layout it maps to.
//!
//! A class id reaches this host by two routes that do not carry the same bytes.
//! A bundle's `moduleinfo.json` writes 32 hexadecimal characters that name the
//! same class on every platform; the `TUID` a factory is handed is COM `GUID`
//! memory, and on Windows that stores the first three `GUID` fields
//! little-endian. Publishing one route's bytes and handing them to the other
//! asks a Windows factory for a class nobody implements — so both routes are
//! converted here and nowhere else.

use vst3::Steinberg::TUID;

/// How a `TUID`'s sixteen bytes are ordered in memory.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TuidLayout {
    /// The order the 32-character spelling carries, which is also what every
    /// non-Windows platform stores.
    Canonical,
    /// COM `GUID` memory: the first three fields little-endian, the trailing
    /// eight bytes in declaration order.
    ComFieldSwapped,
}

impl TuidLayout {
    /// What the running platform's bindings build a `TUID` with. Windows
    /// spells a `TUID` as the system `GUID` type, so its layout is COM's.
    const NATIVE: Self = if cfg!(windows) {
        Self::ComFieldSwapped
    } else {
        Self::Canonical
    };
}

/// Reorder the three leading COM `GUID` fields.
///
/// Its own inverse — reversing the same three runs a second time restores the
/// order it started from — so one function serves both directions.
fn in_layout(mut bytes: [u8; 16], layout: TuidLayout) -> [u8; 16] {
    if layout == TuidLayout::Canonical {
        return bytes;
    }
    bytes[0..4].reverse();
    bytes[4..6].reverse();
    bytes[6..8].reverse();
    bytes
}

/// Parse a class CID as a scan publishes it and a project stores it: 32
/// hexadecimal characters.
pub fn parse_class_id(descriptor_id: &str) -> Result<TUID, String> {
    parse_class_id_as(descriptor_id, TuidLayout::NATIVE)
}

/// Spell a class CID the way a scan publishes it and a project stores it.
pub fn format_class_id(class_id: &TUID) -> String {
    format_class_id_as(class_id, TuidLayout::NATIVE)
}

/// The one spelling this host publishes for a class id read out of a bundle's
/// `moduleinfo.json`, or why that text is not a class id at all.
///
/// The side-car file is written by hand as often as by the SDK's generator, and
/// a scan that publishes whatever it finds there produces a descriptor that can
/// never be loaded — the failure then surfaces when a user tries to open the
/// plugin rather than when it was scanned.
pub fn normalized_class_id(descriptor_id: &str) -> Result<String, String> {
    parse_class_id(descriptor_id).map(|class_id| format_class_id(&class_id))
}

/// Whether two class ids name the same class. Both are in native layout, so
/// this is a byte comparison and nothing here reorders anything.
pub fn same_class_id(left: &TUID, right: &TUID) -> bool {
    left.iter().zip(right.iter()).all(|(a, b)| a == b)
}

fn parse_class_id_as(descriptor_id: &str, layout: TuidLayout) -> Result<TUID, String> {
    let trimmed = descriptor_id.trim();
    if trimmed.len() != 32
        || !trimmed
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(format!(
            "'{descriptor_id}' is not a VST3 class id (expected 32 hexadecimal characters)"
        ));
    }

    let mut canonical = [0u8; 16];
    for (index, slot) in canonical.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&trimmed[index * 2..index * 2 + 2], 16)
            .map_err(|error| format!("'{descriptor_id}' is not a VST3 class id: {error}"))?;
    }

    let mut class_id: TUID = [0; 16];
    for (slot, byte) in class_id.iter_mut().zip(in_layout(canonical, layout)) {
        *slot = byte as std::ffi::c_char;
    }
    Ok(class_id)
}

fn format_class_id_as(class_id: &TUID, layout: TuidLayout) -> String {
    let mut stored = [0u8; 16];
    for (slot, byte) in stored.iter_mut().zip(class_id.iter()) {
        *slot = *byte as u8;
    }
    in_layout(stored, layout)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use vst3::uid;

    const SPELLING: &str = "1122334455667788AABBCCDDEEFF0011";

    fn bytes_of(class_id: &TUID) -> [u8; 16] {
        let mut bytes = [0u8; 16];
        for (slot, byte) in bytes.iter_mut().zip(class_id.iter()) {
            *slot = *byte as u8;
        }
        bytes
    }

    /// The two layouts are pinned by their bytes rather than by a round trip: a
    /// conversion that is its own inverse round-trips perfectly while producing
    /// the wrong bytes on both platforms, and the bytes are what a factory
    /// compares a CID against.
    #[test]
    fn a_class_id_spells_the_declared_order_and_com_swaps_its_first_three_fields() {
        let canonical =
            parse_class_id_as(SPELLING, TuidLayout::Canonical).expect("32 hex characters");
        let com_memory =
            parse_class_id_as(SPELLING, TuidLayout::ComFieldSwapped).expect("32 hex characters");

        assert_eq!(
            bytes_of(&canonical),
            [
                0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF,
                0x00, 0x11
            ]
        );
        assert_eq!(
            bytes_of(&com_memory),
            [
                0x44, 0x33, 0x22, 0x11, 0x66, 0x55, 0x88, 0x77, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF,
                0x00, 0x11
            ],
            "COM stores the first three GUID fields little-endian; the trailing eight are bytes"
        );
    }

    /// The decisive check, and the one that fails on exactly one platform if the
    /// swap is dropped: `uid` is the bindings' own constructor, and a CID this
    /// host parses has to be the bytes that constructor would have produced.
    #[test]
    fn the_parsed_bytes_are_the_ones_the_bindings_own_constructor_builds() {
        assert_eq!(
            bytes_of(&parse_class_id(SPELLING).expect("32 hex characters")),
            bytes_of(&uid(0x1122_3344, 0x5566_7788, 0xAABB_CCDD, 0xEEFF_0011))
        );
    }

    /// A scan publishes this spelling and a project stores it, so parsing and
    /// formatting must be inverses or a saved plugin never loads again.
    #[test]
    fn a_class_id_round_trips_through_the_spelling_projects_store() {
        for layout in [TuidLayout::Canonical, TuidLayout::ComFieldSwapped] {
            let parsed = parse_class_id_as(SPELLING, layout).expect("32 hex characters");

            assert_eq!(format_class_id_as(&parsed, layout), SPELLING);
        }
    }

    #[test]
    fn a_lowercase_class_id_parses_to_the_same_identity() {
        assert_eq!(
            parse_class_id("aabbccddeeff00112233445566778899").expect("hex is case insensitive"),
            parse_class_id("AABBCCDDEEFF00112233445566778899").expect("hex is case insensitive")
        );
    }

    /// Anything that is not a class id must be refused before it reaches a
    /// factory, where the bytes would be read as some other class entirely.
    #[test]
    fn a_malformed_class_id_is_refused_rather_than_padded() {
        assert!(parse_class_id("").is_err());
        assert!(parse_class_id("1122").is_err());
        assert!(parse_class_id("com.example.plugin").is_err());
        assert!(parse_class_id("zz22334455667788AABBCCDDEEFF0011").is_err());
    }
}
