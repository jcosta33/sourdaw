#[derive(Debug, Clone)]
pub enum Tone {
    Cents(f64),
    Ratio(u32, u32),
}

#[derive(Debug, Clone)]
pub struct Scale {
    pub name: String,
    pub description: String,
    pub tones: Vec<Tone>, // Includes the period as the last element
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TuningParseErrorKind {
    MissingDescription,
    MissingCount,
    InvalidCount,
    CountMismatch,
    AllocationFailed,
    InvalidCents,
    InvalidRatio,
    InvalidNumerator,
    InvalidDenominator,
    ZeroNumerator,
    ZeroDenominator,
    InvalidIntegerRatio,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct TuningParseError {
    pub kind: TuningParseErrorKind,
    pub line: usize,
    pub reason: &'static str,
}

impl TuningParseError {
    fn new(kind: TuningParseErrorKind, line: usize, reason: &'static str) -> Self {
        Self { kind, line, reason }
    }
}

impl std::fmt::Display for TuningParseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "line {}: {}", self.line, self.reason)
    }
}

impl std::error::Error for TuningParseError {}

impl Scale {
    pub fn from_scl(content: &str) -> Result<Self, TuningParseError> {
        use TuningParseErrorKind::*;

        let eof_line = content.lines().count().saturating_add(1);
        let mut lines = content
            .lines()
            .enumerate()
            .map(|(index, text)| (index + 1, text.trim()))
            .filter(|(_, text)| !text.is_empty() && !text.starts_with('!'));

        let (_, description) = lines.next().ok_or_else(|| {
            TuningParseError::new(MissingDescription, eof_line, "Missing description line")
        })?;
        let (count_line, count_text) = lines
            .next()
            .ok_or_else(|| TuningParseError::new(MissingCount, eof_line, "Missing count line"))?;
        let count = count_text
            .parse::<usize>()
            .map_err(|_| TuningParseError::new(InvalidCount, count_line, "Invalid tone count"))?;

        // The file, rather than its untrusted count, bounds every allocation.
        if count > lines.clone().count() {
            return Err(TuningParseError::new(
                CountMismatch,
                count_line,
                "Declared tone count exceeds the supplied tones",
            ));
        }
        let mut tones = Vec::new();
        tones.try_reserve_exact(count).map_err(|_| {
            TuningParseError::new(
                AllocationFailed,
                count_line,
                "Unable to reserve tone storage",
            )
        })?;
        for (line, text) in lines.take(count) {
            if text.contains('.') {
                let cents = text.parse::<f64>().map_err(|_| {
                    TuningParseError::new(InvalidCents, line, "Invalid cents value")
                })?;
                if !cents.is_finite() {
                    return Err(TuningParseError::new(
                        InvalidCents,
                        line,
                        "Cents value must be finite",
                    ));
                }
                tones.push(Tone::Cents(cents));
            } else if let Some((numerator, denominator)) = text.split_once('/') {
                if denominator.contains('/') {
                    return Err(TuningParseError::new(InvalidRatio, line, "Invalid ratio"));
                }
                let numerator = numerator.parse::<u32>().map_err(|_| {
                    TuningParseError::new(InvalidNumerator, line, "Invalid numerator")
                })?;
                let denominator = denominator.parse::<u32>().map_err(|_| {
                    TuningParseError::new(InvalidDenominator, line, "Invalid denominator")
                })?;
                tones.push(Self::ratio(numerator, denominator, line)?);
            } else {
                let numerator = text.parse::<u32>().map_err(|_| {
                    TuningParseError::new(InvalidIntegerRatio, line, "Invalid integer ratio")
                })?;
                tones.push(Self::ratio(numerator, 1, line)?);
            }
        }

        Ok(Self {
            name: "Unnamed".to_string(),
            description: description.to_string(),
            tones,
        })
    }

    /// Reject degenerate ratio terms before they can produce infinite cents.
    fn ratio(numerator: u32, denominator: u32, line: usize) -> Result<Tone, TuningParseError> {
        if numerator == 0 {
            return Err(TuningParseError::new(
                TuningParseErrorKind::ZeroNumerator,
                line,
                "Zero numerator in ratio",
            ));
        }
        if denominator == 0 {
            return Err(TuningParseError::new(
                TuningParseErrorKind::ZeroDenominator,
                line,
                "Zero denominator in ratio",
            ));
        }

        Ok(Tone::Ratio(numerator, denominator))
    }
}

#[cfg(test)]
mod tests {
    use super::{Scale, Tone};

    #[test]
    fn a_well_formed_scale_parses_every_tone_shape() {
        let scale = Scale::from_scl("! demo.scl\nDemo scale\n 3\n 100.0\n 3/2\n 2\n")
            .expect("a well-formed scale must parse");

        assert_eq!(scale.description, "Demo scale");
        assert_eq!(scale.tones.len(), 3);
        assert!(matches!(scale.tones[0], Tone::Cents(c) if (c - 100.0).abs() < 1e-9));
        assert!(matches!(scale.tones[1], Tone::Ratio(3, 2)));
        assert!(matches!(scale.tones[2], Tone::Ratio(2, 1)));
    }

    #[test]
    fn a_zero_denominator_is_rejected() {
        let error =
            Scale::from_scl("! demo.scl\nDemo\n 1\n 3/0\n").expect_err("3/0 is not a pitch ratio");

        assert_eq!(error.to_string(), "line 4: Zero denominator in ratio");
    }

    #[test]
    fn a_zero_numerator_is_rejected() {
        let error =
            Scale::from_scl("! demo.scl\nDemo\n 1\n 0/4\n").expect_err("0/4 is not a pitch ratio");

        assert_eq!(error.to_string(), "line 4: Zero numerator in ratio");
    }

    #[test]
    fn a_zero_integer_ratio_is_rejected() {
        let error =
            Scale::from_scl("! demo.scl\nDemo\n 1\n 0\n").expect_err("0 is not a pitch ratio");

        assert_eq!(error.to_string(), "line 4: Zero numerator in ratio");
    }

    #[test]
    fn a_junk_line_is_rejected() {
        let error = Scale::from_scl("! demo.scl\nDemo\n 1\n not-a-tone\n")
            .expect_err("a junk tone line must not be accepted");

        assert_eq!(error.to_string(), "line 4: Invalid integer ratio");
    }

    #[test]
    fn a_truncated_tone_list_is_rejected() {
        let error = Scale::from_scl("! demo.scl\nDemo\n 3\n 100.0\n")
            .expect_err("a scale short of its declared count must not be accepted");

        assert_eq!(
            error.to_string(),
            "line 3: Declared tone count exceeds the supplied tones"
        );
    }
}

#[cfg(test)]
mod scala_parse_errors {
    use super::{Scale, TuningParseErrorKind};

    #[test]
    fn physical_line_survives_comments() {
        let error = Scale::from_scl("! demo.scl\nDemo\n! count comment\n1\n3/0\n")
            .expect_err("zero denominator must be rejected");
        assert!(error.to_string().contains("line 5"), "{error}");
        assert_eq!(error.kind, TuningParseErrorKind::ZeroDenominator);
        assert_eq!(error.line, 5);
    }

    #[test]
    fn huge_declared_count_returns_without_panicking() {
        let content = format!("Demo\n{}\n2/1\n", usize::MAX);
        let result = std::panic::catch_unwind(|| Scale::from_scl(&content));
        assert!(result.is_ok(), "untrusted count must not panic");
        let error = result
            .expect("already checked")
            .expect_err("tiny file cannot supply the count");
        assert_eq!(error.kind, TuningParseErrorKind::CountMismatch);
        assert_eq!(error.line, 2);
    }

    #[test]
    fn overflowing_count_is_a_line_two_error() {
        let content = format!("Demo\n{}0\n2/1\n", usize::MAX);
        let error = Scale::from_scl(&content).expect_err("overflowing count must be rejected");
        assert_eq!(error.kind, TuningParseErrorKind::InvalidCount);
        assert_eq!(error.line, 2);
    }

    #[test]
    fn missing_required_lines_point_past_physical_eof() {
        for (content, kind, line) in [
            ("! comment\n\n", TuningParseErrorKind::MissingDescription, 3),
            (
                "! comment\nDemo\n! trailing comment\n",
                TuningParseErrorKind::MissingCount,
                4,
            ),
        ] {
            let error = Scale::from_scl(content).expect_err("required line is absent");
            assert_eq!(error.kind, kind);
            assert_eq!(error.line, line);
        }
    }

    #[test]
    fn invalid_tones_keep_physical_lines_and_bounded_reasons() {
        for (tone, kind) in [
            ("1.0e400", TuningParseErrorKind::InvalidCents),
            ("1.2x", TuningParseErrorKind::InvalidCents),
            ("3/2/1", TuningParseErrorKind::InvalidRatio),
            ("x/2", TuningParseErrorKind::InvalidNumerator),
            ("3/x", TuningParseErrorKind::InvalidDenominator),
            ("0/2", TuningParseErrorKind::ZeroNumerator),
            (
                "secret-file-text",
                TuningParseErrorKind::InvalidIntegerRatio,
            ),
        ] {
            let content = format!("! comment\nDemo\n1\n\n! tone comment\n{tone}\n");
            let error = Scale::from_scl(&content).expect_err("tone must be rejected");
            assert_eq!(error.kind, kind);
            assert_eq!(error.line, 6);
            assert!(!error.reason.contains(tone));
            assert!(error.reason.len() <= 200);
        }
    }
}
