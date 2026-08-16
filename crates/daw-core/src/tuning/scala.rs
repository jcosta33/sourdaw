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

impl Scale {
    pub fn from_scl(content: &str) -> Result<Self, String> {
        let mut lines = content
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with('!'));

        let description = lines.next().ok_or("Missing description line")?.to_string();
        let count_str = lines.next().ok_or("Missing count line")?;
        let count = count_str.parse::<usize>().map_err(|_| "Invalid count")?;

        let mut tones = Vec::with_capacity(count);
        for line in lines.take(count) {
            if line.contains('.') {
                let cents = line
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid cents: {}", line))?;
                tones.push(Tone::Cents(cents));
            } else if line.contains('/') {
                let parts: Vec<&str> = line.split('/').collect();
                if parts.len() != 2 {
                    return Err(format!("Invalid ratio: {}", line));
                }
                let n = parts[0].parse::<u32>().map_err(|_| "Invalid numerator")?;
                let d = parts[1].parse::<u32>().map_err(|_| "Invalid denominator")?;
                tones.push(Self::ratio(n, d, line)?);
            } else {
                let n = line
                    .parse::<u32>()
                    .map_err(|_| format!("Invalid integer ratio: {}", line))?;
                tones.push(Self::ratio(n, 1, line)?);
            }
        }

        if tones.len() != count {
            return Err(format!("Expected {} tones, found {}", count, tones.len()));
        }

        Ok(Self {
            name: "Unnamed".to_string(),
            description,
            tones,
        })
    }

    /// Build a ratio tone, rejecting the degenerate terms.
    ///
    /// A zero numerator or denominator is not a pitch: the tuning table turns
    /// the ratio into `1200 * log2(n/d)`, so either zero yields ±infinity cents
    /// and poisons all 128 entries. Scala files carrying one are malformed and
    /// must fail at parse time, where the error can still name the line.
    fn ratio(numerator: u32, denominator: u32, line: &str) -> Result<Tone, String> {
        if numerator == 0 {
            return Err(format!("Zero numerator in ratio: {}", line));
        }
        if denominator == 0 {
            return Err(format!("Zero denominator in ratio: {}", line));
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

        assert_eq!(error, "Zero denominator in ratio: 3/0");
    }

    #[test]
    fn a_zero_numerator_is_rejected() {
        let error =
            Scale::from_scl("! demo.scl\nDemo\n 1\n 0/4\n").expect_err("0/4 is not a pitch ratio");

        assert_eq!(error, "Zero numerator in ratio: 0/4");
    }

    #[test]
    fn a_zero_integer_ratio_is_rejected() {
        let error =
            Scale::from_scl("! demo.scl\nDemo\n 1\n 0\n").expect_err("0 is not a pitch ratio");

        assert_eq!(error, "Zero numerator in ratio: 0");
    }

    #[test]
    fn a_junk_line_is_rejected() {
        let error = Scale::from_scl("! demo.scl\nDemo\n 1\n not-a-tone\n")
            .expect_err("a junk tone line must not be accepted");

        assert_eq!(error, "Invalid integer ratio: not-a-tone");
    }

    #[test]
    fn a_truncated_tone_list_is_rejected() {
        let error = Scale::from_scl("! demo.scl\nDemo\n 3\n 100.0\n")
            .expect_err("a scale short of its declared count must not be accepted");

        assert_eq!(error, "Expected 3 tones, found 1");
    }
}
