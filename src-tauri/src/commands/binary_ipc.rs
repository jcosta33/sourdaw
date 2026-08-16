//! Unwrapping Tauri's binary IPC path (`InvokeBody::Raw`) into plain arguments.
//!
//! A `Vec<u8>` argument or return value is serialized as a JSON array of decimal
//! numbers, which costs ~3.57x the raw byte length for high-entropy data. The
//! fix is to make the whole invoke message the buffer — but then nothing can
//! ride alongside it, so the payload's addressing (a file path, a plugin
//! instance id) has to travel in a header instead.
//!
//! Header values must be printable ASCII while the values themselves are
//! arbitrary UTF-8, so the frontend percent-encodes them (`encodeURIComponent`).
//! Decoding and bounding is the shared decision and belongs to
//! `sourdaw_native::commands::binary_ipc`; this module only knows where Tauri
//! puts the header and the body.

use sourdaw_native::commands::binary_ipc::decode_bounded_percent_encoded_header;

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
