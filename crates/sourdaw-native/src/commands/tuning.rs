use daw_core::tuning::{
    scala::{Scale, TuningParseError},
    TuningTable,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SclParseResult {
    pub name: String,
    pub description: String,
    pub frequencies: Vec<f64>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum SclParseResponse {
    Parsed(SclParseResult),
    Invalid { error: TuningParseError },
}

pub fn parse_scl(
    content: String,
    root_note: u8,
    root_freq: f64,
) -> Result<SclParseResponse, String> {
    let scale = match Scale::from_scl(&content) {
        Ok(scale) => scale,
        Err(error) => return Ok(SclParseResponse::Invalid { error }),
    };
    let table = TuningTable::from_scale(&scale, root_note, root_freq)?;

    Ok(SclParseResponse::Parsed(SclParseResult {
        name: scale.name,
        description: scale.description,
        frequencies: table.frequencies.to_vec(),
    }))
}

#[cfg(test)]
mod scala_parse_errors {
    use super::parse_scl;

    #[test]
    fn malformed_scale_is_structured_json() {
        let response = parse_scl(
            "! demo.scl\nDemo\n! count comment\n1\n3/0\n".into(),
            69,
            440.0,
        )
        .expect("domain errors must survive as response data");
        let json = serde_json::to_value(response).expect("response must serialize");
        assert_eq!(json["error"]["kind"], "zero-denominator");
        assert_eq!(json["error"]["line"], 5);
        assert_eq!(json["error"]["reason"], "Zero denominator in ratio");
    }

    #[test]
    fn successful_wire_shape_and_root_are_unchanged() {
        let response = parse_scl("Mixed\n3\n100.0\n3/2\n2/1\n".into(), 69, 440.0)
            .expect("valid scale must parse");
        let json = serde_json::to_value(response).expect("response must serialize");
        assert_eq!(json["name"], "Unnamed");
        assert_eq!(json["description"], "Mixed");
        let frequencies = json["frequencies"].as_array().expect("frequency array");
        assert_eq!(frequencies.len(), 128);
        assert_eq!(frequencies[69], 440.0);
        assert_eq!(frequencies[72], 880.0);
        assert!(json.get("error").is_none());
    }

    #[test]
    fn table_failure_remains_a_rejected_command() {
        assert!(parse_scl("Demo\n1\n2/1\n".into(), 69, f64::NAN).is_err());
    }
}
