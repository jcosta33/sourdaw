use sourdaw_native::commands::tuning as native;

pub use sourdaw_native::commands::tuning::SclParseResult;

#[tauri::command]
pub fn parse_scl(content: String, root_note: u8, root_freq: f64) -> Result<SclParseResult, String> {
    native::parse_scl(content, root_note, root_freq)
}
