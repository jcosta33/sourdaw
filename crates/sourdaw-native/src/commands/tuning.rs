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

    #[test]
    fn scala_browser_parity() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src/modules/Project/services/__tests__/fixtures/scalaParity.json"
        )))
        .expect("fixed Scala parity fixture");
        assert_eq!(fixture["reference"]["rootNote"], 69);
        assert_eq!(fixture["reference"]["rootFrequency"], 440);
        assert_eq!(fixture["reference"]["absoluteToleranceHz"], 1e-9);

        for expected in fixture["parsed"].as_array().expect("parsed cases") {
            let id = expected["id"].as_str().expect("case id");
            let content = expected["content"].as_str().expect("scale content");
            let result = parse_scl(content.to_owned(), 69, 440.0).expect("valid reference scale");
            let actual = serde_json::to_value(result).expect("serialized native response");
            assert_eq!(actual["name"], expected["name"], "{id}: name");
            assert_eq!(
                actual["description"], expected["description"],
                "{id}: description"
            );
            let actual_frequencies = actual["frequencies"].as_array().expect("native table");
            let expected_frequencies = expected["frequencies"].as_array().expect("reference table");
            assert_eq!(actual_frequencies.len(), 128, "{id}");
            assert_eq!(expected_frequencies.len(), 128, "{id}");
            for (note, (actual, expected)) in actual_frequencies
                .iter()
                .zip(expected_frequencies)
                .enumerate()
            {
                let actual = actual.as_f64().expect("native frequency");
                let expected = expected.as_f64().expect("reference frequency");
                assert!(actual.is_finite() && actual > 0.0, "{id}: note {note}");
                assert!(
                    (actual - expected).abs() < 1e-9,
                    "{id}: note {note}: expected {expected}, got {actual}"
                );
            }
        }
        for expected in fixture["invalid"].as_array().expect("invalid cases") {
            let id = expected["id"].as_str().expect("case id");
            let content = expected["content"].as_str().expect("scale content");
            let result = parse_scl(content.to_owned(), 69, 440.0).expect("structured parse error");
            assert_eq!(
                serde_json::to_value(result).expect("serialized native error"),
                serde_json::json!({ "error": expected["error"] }),
                "{id}"
            );
        }
        for expected in fixture["rejected"].as_array().expect("rejected cases") {
            let content = expected["content"].as_str().expect("scale content");
            let prefix = expected["errorPrefix"].as_str().expect("rejection prefix");
            let error =
                parse_scl(content.to_owned(), 69, 440.0).expect_err("unrepresentable table");
            assert!(error.starts_with(prefix), "{error}");
        }
    }
}
