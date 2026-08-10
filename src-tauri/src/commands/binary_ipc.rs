//! Shared helpers for commands that take their payload over Tauri's binary IPC
//! path (`InvokeBody::Raw`) instead of a JSON body.
//!
//! A `Vec<u8>` argument or return value is serialized as a JSON array of decimal
//! numbers, which costs ~3.57x the raw byte length for high-entropy data. The
//! fix is to make the whole invoke message the buffer — but then nothing can
//! ride alongside it, so the payload's addressing (a file path, a plugin
//! instance id) has to travel in a header instead.
//!
//! Header values must be printable ASCII while the values themselves are
//! arbitrary UTF-8, so the frontend percent-encodes them (`encodeURIComponent`)
//! and this module decodes them back. Every raw-body command shares this one
//! validation chain — present, ASCII, well-formed escapes, valid UTF-8 — so no
//! command can drift into accepting something the others reject.

const MAX_PERCENT_ENCODED_HEADER_BYTES: usize = 4096 * 3;

/// Decode a percent-encoded (`encodeURIComponent`) header value back to UTF-8.
///
/// Decoding is done here rather than pulling in a dependency: the grammar is
/// three characters wide and fully specified.
pub(crate) fn decode_percent_encoded(value: &str) -> Result<String, String> {
    let raw = value.as_bytes();
    let mut decoded = Vec::with_capacity(raw.len());
    let mut index = 0;

    while index < raw.len() {
        if raw[index] != b'%' {
            decoded.push(raw[index]);
            index += 1;
            continue;
        }

        if index + 2 >= raw.len() {
            return Err("Malformed percent-encoded path: truncated escape".to_string());
        }

        let high = (raw[index + 1] as char)
            .to_digit(16)
            .ok_or_else(|| "Malformed percent-encoded path: invalid hex digit".to_string())?;
        let low = (raw[index + 2] as char)
            .to_digit(16)
            .ok_or_else(|| "Malformed percent-encoded path: invalid hex digit".to_string())?;

        decoded.push(((high << 4) | low) as u8);
        index += 3;
    }

    String::from_utf8(decoded)
        .map_err(|_| "Malformed percent-encoded path: not valid UTF-8".to_string())
}

fn decode_bounded_percent_encoded_header(value: &str, header_name: &str) -> Result<String, String> {
    if value.len() > MAX_PERCENT_ENCODED_HEADER_BYTES {
        return Err(format!(
            "Header '{header_name}' exceeds {MAX_PERCENT_ENCODED_HEADER_BYTES}-byte encoded limit"
        ));
    }

    decode_percent_encoded(value)
}

/// Read a required percent-encoded header off a raw-body invoke request.
///
/// The header must be present, printable ASCII, and bounded before it is
/// decoded, so malformed input cannot force an unbounded decode allocation.
pub(crate) fn read_percent_encoded_header(
    request: &tauri::ipc::Request<'_>,
    header_name: &str,
) -> Result<String, String> {
    let encoded = request
        .headers()
        .get(header_name)
        .ok_or_else(|| format!("Missing '{}' header", header_name))?
        .to_str()
        .map_err(|_| format!("Header '{}' is not valid ASCII", header_name))?;

    decode_bounded_percent_encoded_header(encoded, header_name)
}

/// Borrow the raw bytes of an invoke request whose whole message is the payload.
///
/// Tauri falls back to a JSON body where raw bodies are unsupported, so that
/// case is rejected explicitly instead of being misread as an empty payload.
pub(crate) fn raw_body_bytes<'request>(
    request: &'request tauri::ipc::Request<'_>,
    command_name: &str,
) -> Result<&'request [u8], String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.as_slice()),
        tauri::ipc::InvokeBody::Json(_) => {
            Err(format!("{} requires a raw byte body", command_name))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_decode_a_percent_encoded_ascii_path_unchanged() {
        let decoded = decode_percent_encoded("/exports/Sourdaw_Bake_1.wav").unwrap();

        assert_eq!(decoded, "/exports/Sourdaw_Bake_1.wav");
    }

    #[test]
    fn should_decode_multibyte_utf8_escapes_produced_by_encode_uri_component() {
        // encodeURIComponent('/Users/josé/Música/kick.wav')
        let encoded = "%2FUsers%2Fjos%C3%A9%2FM%C3%BAsica%2Fkick.wav";

        let decoded = decode_percent_encoded(encoded).unwrap();

        assert_eq!(decoded, "/Users/josé/Música/kick.wav");
    }

    #[test]
    fn should_decode_a_space_and_reserved_characters() {
        let decoded = decode_percent_encoded("/exports/My%20Track%20%231.wav").unwrap();

        assert_eq!(decoded, "/exports/My Track #1.wav");
    }

    #[test]
    fn should_reject_a_truncated_percent_escape() {
        let result = decode_percent_encoded("/exports/bad%4");

        assert_eq!(
            result.unwrap_err(),
            "Malformed percent-encoded path: truncated escape"
        );
    }

    #[test]
    fn should_reject_a_non_hex_percent_escape() {
        let result = decode_percent_encoded("/exports/bad%ZZ.wav");

        assert_eq!(
            result.unwrap_err(),
            "Malformed percent-encoded path: invalid hex digit"
        );
    }

    #[test]
    fn should_reject_escapes_that_decode_to_invalid_utf8() {
        let result = decode_percent_encoded("%FF%FE");

        assert_eq!(
            result.unwrap_err(),
            "Malformed percent-encoded path: not valid UTF-8"
        );
    }

    #[test]
    fn should_decode_a_percent_encoded_plugin_instance_id() {
        // encodeURIComponent('inst é/1')
        let decoded = decode_percent_encoded("inst%20%C3%A9%2F1").unwrap();

        assert_eq!(decoded, "inst é/1");
    }

    #[test]
    fn percent_encoded_header_boundary_rejects_oversize_before_decode() {
        let encoded = "A".repeat(12_289);

        let result = decode_bounded_percent_encoded_header(&encoded, "x-sourdaw-path");

        assert_eq!(
            result.unwrap_err(),
            "Header 'x-sourdaw-path' exceeds 12288-byte encoded limit"
        );
    }

    #[test]
    fn percent_encoded_header_boundary_accepts_a_valid_unicode_path() {
        let encoded = "%2FUsers%2Fjos%C3%A9%2FM%C3%BAsica%2Fkick.wav";

        let decoded = decode_bounded_percent_encoded_header(encoded, "x-sourdaw-path").unwrap();

        assert_eq!(decoded, "/Users/josé/Música/kick.wav");
    }
}
