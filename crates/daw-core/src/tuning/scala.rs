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
                tones.push(Tone::Ratio(n, d));
            } else {
                let n = line
                    .parse::<u32>()
                    .map_err(|_| format!("Invalid integer ratio: {}", line))?;
                tones.push(Tone::Ratio(n, 1));
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
}
