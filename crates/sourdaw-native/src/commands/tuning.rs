use daw_core::tuning::{scala::Scale, TuningTable};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SclParseResult {
    pub name: String,
    pub description: String,
    pub frequencies: Vec<f64>,
}

pub fn parse_scl(content: String, root_note: u8, root_freq: f64) -> Result<SclParseResult, String> {
    let scale = Scale::from_scl(&content)?;
    let table = TuningTable::from_scale(&scale, root_note, root_freq)?;

    Ok(SclParseResult {
        name: scale.name,
        description: scale.description,
        frequencies: table.frequencies.to_vec(),
    })
}
