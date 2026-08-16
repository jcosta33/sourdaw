/// Scala .scl and AnaMark .tun file format parsers.
///
/// Scala: comments (!), description, note count N, then N pitch values
/// as either cents (408.0) or ratios (5/4).
///
/// AnaMark: [Scale Begin] / [Scale End] sections with per-note cent values.

/// A parsed Scala scale.
pub struct ScalaScale {
    pub description: [u8; 64],
    pub note_count: usize,
    /// Cents values for each scale degree (up to 128 notes).
    pub cents: [f32; 128],
}

impl ScalaScale {
    pub fn new() -> Self {
        Self {
            description: [0; 64],
            note_count: 0,
            cents: [0.0; 128],
        }
    }

    /// Parse a Scala .scl file from text content, or `None` when the text is
    /// not a well-formed .scl. Every rejection path here exists because the
    /// alternative is installing a silently wrong tuning: a defaulted pitch
    /// value is indistinguishable from a real 1/1 once it reaches the offsets
    /// table, so a value that does not parse fails the whole file.
    pub fn parse_scl(text: &str) -> Option<Self> {
        let mut scale = Self::new();
        // Comment lines start with '!' in the first column. The description
        // line may legitimately be blank, so blanks are only skipped after it.
        let mut lines = text.lines().filter(|l| !l.starts_with('!'));

        // First non-comment line = description (possibly empty).
        let desc = lines.next()?;
        let bytes = desc.as_bytes();
        let len = bytes.len().min(64);
        scale.description[..len].copy_from_slice(&bytes[..len]);

        let mut values = lines.filter(|l| !l.trim().is_empty());

        // Second line = declared note count.
        let count: usize = values.next()?.trim().parse().ok()?;
        if count > scale.cents.len() {
            return None;
        }

        // Remaining lines = pitch values. Scala's rule is positional, not
        // magnitude-based: a value is in cents if and only if it contains a
        // '.', and is a ratio otherwise ("71" is the ratio 71/1, "3/2" is a
        // fifth, "701.955" is cents). A bare integer meant as cents is the
        // file author's error and must not be guessed at here.
        for slot in scale.cents.iter_mut().take(count) {
            // Anything after the pitch value on the line is a comment.
            let field = values.next()?.split_whitespace().next()?;
            *slot = if field.contains('.') {
                field.parse::<f32>().ok()?
            } else {
                let (p, q) = match field.split_once('/') {
                    Some((p, q)) => (p.parse::<f64>().ok()?, q.parse::<f64>().ok()?),
                    None => (field.parse::<f64>().ok()?, 1.0),
                };
                if p <= 0.0 || q <= 0.0 {
                    return None;
                }
                (1200.0 * (p / q).log2()) as f32
            };
        }

        // A file that carries more degrees than it declares is malformed; its
        // declared count cannot be trusted to select the right ones.
        if values.next().is_some() {
            return None;
        }

        scale.note_count = count;
        Some(scale)
    }

    /// Convert the scale to per-pitch-class cent offsets relative to 12-TET.
    /// Returns [12] offsets for C through B. Only a 12-degree scale maps onto
    /// this table without loss, which is why import rejects any other size
    /// rather than truncating one silently.
    pub fn to_12tet_offsets(&self) -> [f32; 12] {
        let mut offsets = [0.0_f32; 12];
        if self.note_count == 0 {
            return offsets;
        }

        // Map scale degrees to the nearest 12-TET pitch class
        for i in 0..self.note_count.min(12) {
            let tet_cents = (i as f32 + 1.0) * 100.0; // 12-TET: 100, 200, 300...
            let scale_cents = self.cents[i];
            offsets[(i + 1) % 12] = scale_cents - tet_cents;
        }

        offsets
    }
}

/// A parsed AnaMark .tun tuning.
pub struct AnaMarkTuning {
    /// Reference frequency declared by the file, or `None` when it declares
    /// none. Absence is not the same as 440: a file that says nothing about the
    /// reference must leave the user's own reference alone.
    pub base_freq: Option<f32>,
    pub cents: [f32; 128], // per-note cent values relative to base
}

impl AnaMarkTuning {
    pub fn new() -> Self {
        // Default: 12-TET, no declared reference
        let mut cents = [0.0_f32; 128];
        for (i, slot) in cents.iter_mut().enumerate() {
            *slot = (i as f32 - 69.0) * 100.0;
        }
        Self {
            base_freq: None,
            cents,
        }
    }

    /// Parse an AnaMark .tun file from text, or `None` when the text is not a
    /// recognizable tuning: a `[Scale Begin]` section carrying at least one
    /// `note = cents` pair, with every line inside it well formed. Without the
    /// structural requirement any text at all "parses" into a default 12-TET
    /// table and imports as a successful, entirely fictional tuning.
    pub fn parse_tun(text: &str) -> Option<Self> {
        let mut tuning = Self::new();
        let mut in_scale = false;
        let mut saw_scale_section = false;
        let mut parsed_values = 0_usize;

        for line in text.lines() {
            let trimmed = line.trim();

            if trimmed == "[Scale Begin]" {
                in_scale = true;
                saw_scale_section = true;
                continue;
            }
            if trimmed == "[Scale End]" {
                in_scale = false;
                continue;
            }

            if trimmed.starts_with("BaseFreq") {
                // A declared-but-unreadable reference is corruption, not
                // absence — it must not fall back to a plausible default.
                let val_str = trimmed.split('=').nth(1)?;
                tuning.base_freq = Some(val_str.trim().parse().ok()?);
                continue;
            }

            if in_scale {
                if trimmed.is_empty() {
                    continue;
                }
                // Format: note_number = cents_value
                let (note_str, cents_str) = trimmed.split_once('=')?;
                let note: usize = note_str.trim().parse().ok()?;
                let cents: f32 = cents_str.trim().parse().ok()?;
                if note >= tuning.cents.len() {
                    return None;
                }
                tuning.cents[note] = cents;
                parsed_values += 1;
            }
        }

        if !saw_scale_section || parsed_values == 0 {
            return None;
        }

        Some(tuning)
    }

    /// Convert to per-pitch-class offsets (0=C ... 11=B) relative to 12-TET.
    pub fn to_12tet_offsets(&self) -> [f32; 12] {
        let mut offsets = [0.0_f32; 12];
        // Use notes around middle octave (60-71 = C4-B4)
        for i in 0..12 {
            let note = 60 + i;
            let tet_cents = (note as f32 - 69.0) * 100.0;
            offsets[i] = self.cents[note] - tet_cents;
        }
        offsets
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A well-formed 12-degree .scl in cents, equal temperament.
    const TWELVE_TET_SCL: &str = "\
! equal.scl
!
12-tone equal temperament
 12
!
 100.0
 200.0
 300.0
 400.0
 500.0
 600.0
 700.0
 800.0
 900.0
 1000.0
 1100.0
 2/1
";

    fn tun_with(body: &str) -> String {
        format!("[Tuning]\n[Scale Begin]\n{body}[Scale End]\n")
    }

    // -- Scala .scl -------------------------------------------------------

    #[test]
    fn scl_parses_a_well_formed_twelve_tone_scale() {
        let scale = ScalaScale::parse_scl(TWELVE_TET_SCL).expect("valid .scl rejected");
        assert_eq!(scale.note_count, 12);
        assert!((scale.cents[0] - 100.0).abs() < 0.001);
        assert!((scale.cents[10] - 1100.0).abs() < 0.001);
        assert!(
            (scale.cents[11] - 1200.0).abs() < 0.001,
            "2/1 must be 1200c"
        );
        for (i, offset) in scale.to_12tet_offsets().iter().enumerate() {
            assert!(offset.abs() < 0.01, "12-TET offset {i} was {offset}");
        }
    }

    /// The .scl spec decides cents-vs-ratio by the presence of a '.', never by
    /// magnitude. A bare integer is a ratio over 1 at every size, so "150" is
    /// 150/1 — nearly two and a half octaves — not 150 cents.
    ///
    /// The magnitude guess this replaces (`> 100.0` means cents) agrees with
    /// the spec below 100, which is why the decisive row here is the large
    /// integer: under the guess it reads back 150 instead of 8674.
    #[test]
    fn scl_pitch_type_is_decided_by_the_decimal_point() {
        let text = "ratio vs cents\n 5\n 701.955\n 3/2\n 71\n 150\n 150.0\n";
        let scale = ScalaScale::parse_scl(text).expect("valid .scl rejected");
        assert!((scale.cents[0] - 701.955).abs() < 0.01, "cents literal");

        let fifth = 1200.0 * (1.5_f32).log2();
        assert!((scale.cents[1] - fifth).abs() < 0.01, "p/q ratio");

        let small = 1200.0 * (71.0_f32).log2();
        assert!(
            (scale.cents[2] - small).abs() < 0.05,
            "bare 71 must be the ratio 71/1 ({small:.1}c), read {}",
            scale.cents[2]
        );

        let large = 1200.0 * (150.0_f32).log2();
        assert!(
            (scale.cents[3] - large).abs() < 0.05,
            "bare 150 must be the ratio 150/1 ({large:.1}c), read {}",
            scale.cents[3]
        );

        assert!(
            (scale.cents[4] - 150.0).abs() < 0.01,
            "150.0 carries a '.' and must be 150 cents, read {}",
            scale.cents[4]
        );
    }

    #[test]
    fn scl_allows_a_blank_description_line() {
        let text = "\n 1\n 3/2\n";
        let scale = ScalaScale::parse_scl(text).expect("blank description rejected");
        assert_eq!(scale.note_count, 1);
    }

    #[test]
    fn scl_ignores_a_trailing_comment_on_a_pitch_line() {
        let text = "with comments\n 1\n 700.0 near-fifth\n";
        let scale = ScalaScale::parse_scl(text).expect("commented pitch line rejected");
        assert!((scale.cents[0] - 700.0).abs() < 0.001);
    }

    #[test]
    fn scl_rejects_text_that_is_not_a_scale() {
        for garbage in [
            "",
            "just one line of prose",
            "prose\nmore prose\nand more",
            "\u{0}\u{1}\u{2}",
        ] {
            assert!(
                ScalaScale::parse_scl(garbage).is_none(),
                "garbage accepted as a scale: {garbage:?}"
            );
        }
    }

    #[test]
    fn scl_rejects_an_unparseable_pitch_line() {
        let text = "broken\n 3\n 100.0\n not-a-pitch\n 300.0\n";
        assert!(ScalaScale::parse_scl(text).is_none());
    }

    #[test]
    fn scl_rejects_a_non_positive_ratio() {
        assert!(ScalaScale::parse_scl("bad ratio\n 1\n 3/0\n").is_none());
        assert!(ScalaScale::parse_scl("bad ratio\n 1\n -3/2\n").is_none());
    }

    #[test]
    fn scl_rejects_a_degree_count_that_does_not_match_the_header() {
        assert!(
            ScalaScale::parse_scl("too few\n 5\n 100.0\n 200.0\n").is_none(),
            "fewer degrees than declared accepted"
        );
        assert!(
            ScalaScale::parse_scl("too many\n 2\n 100.0\n 200.0\n 300.0\n").is_none(),
            "more degrees than declared accepted"
        );
        assert!(
            ScalaScale::parse_scl("no count\n many\n 100.0\n").is_none(),
            "unparseable note count accepted"
        );
        assert!(
            ScalaScale::parse_scl("oversized\n 129\n").is_none(),
            "count beyond the pitch table accepted"
        );
    }

    // -- AnaMark .tun -----------------------------------------------------

    #[test]
    fn tun_parses_a_minimal_scale_section() {
        let text = tun_with("60=-900.0\n69=0.0\n");
        let tuning = AnaMarkTuning::parse_tun(&text).expect("valid .tun rejected");
        assert_eq!(tuning.base_freq, None);
        assert!((tuning.cents[60] + 900.0).abs() < 0.001);
        assert!((tuning.cents[69] - 0.0).abs() < 0.001);
    }

    #[test]
    fn tun_offsets_are_relative_to_twelve_tet() {
        // C4 dropped 10 cents, everything else left at 12-TET.
        let text = tun_with("60=-910.0\n");
        let tuning = AnaMarkTuning::parse_tun(&text).expect("valid .tun rejected");
        let offsets = tuning.to_12tet_offsets();
        assert!((offsets[0] + 10.0).abs() < 0.001, "C offset {}", offsets[0]);
        for (i, offset) in offsets.iter().enumerate().skip(1) {
            assert!(offset.abs() < 0.001, "pitch class {i} moved: {offset}");
        }
    }

    #[test]
    fn tun_reads_a_declared_base_frequency() {
        let text = format!("BaseFreq=432.0\n{}", tun_with("69=0.0\n"));
        let tuning = AnaMarkTuning::parse_tun(&text).expect("valid .tun rejected");
        assert_eq!(tuning.base_freq, Some(432.0));
    }

    #[test]
    fn tun_rejects_text_that_is_not_a_tuning() {
        for garbage in [
            "",
            "hello world",
            "BaseFreq=440.0\n",
            "[Scale Begin]\n[Scale End]\n",
        ] {
            assert!(
                AnaMarkTuning::parse_tun(garbage).is_none(),
                "garbage accepted as a tuning: {garbage:?}"
            );
        }
    }

    #[test]
    fn tun_rejects_a_malformed_scale_line() {
        assert!(
            AnaMarkTuning::parse_tun(&tun_with("60=-900.0\nnonsense\n")).is_none(),
            "line without a '=' accepted"
        );
        assert!(
            AnaMarkTuning::parse_tun(&tun_with("60=not-a-number\n")).is_none(),
            "unparseable cents accepted"
        );
        assert!(
            AnaMarkTuning::parse_tun(&tun_with("999=0.0\n")).is_none(),
            "out-of-range note accepted"
        );
    }

    #[test]
    fn tun_rejects_an_unreadable_base_frequency() {
        let text = format!("BaseFreq=abc\n{}", tun_with("69=0.0\n"));
        assert!(AnaMarkTuning::parse_tun(&text).is_none());
    }
}
