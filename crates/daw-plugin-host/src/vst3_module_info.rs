//! Reading a bundle's `moduleinfo.json` without loading its binary.
//!
//! A VST3 bundle may ship a description of the classes it contains. When it
//! does, a scan can enumerate them by reading a file — no `dlopen`, no entry
//! point, no third-party code in any process. That is the cheapest and safest
//! answer available, so it is tried first; a bundle without the file still
//! enumerates through the bounded worker's load path, and neither route is a
//! fallback for the other's failure to *parse*.
//!
//! The file is JSON5, not JSON. The SDK's own generator emits comments, and
//! `serde_json` rejects those outright — so the text is normalised to JSON
//! first. Only the two JSON5 extensions the format actually uses are handled:
//! comments and trailing commas. A file using any other extension fails to
//! parse and the caller falls back to loading the module, which is the correct
//! outcome: an unreadable description is not a description.

use serde::Deserialize;

/// One class a bundle declares.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ModuleInfoClass {
    #[serde(rename = "CID")]
    pub cid: String,
    #[serde(rename = "Category")]
    pub category: String,
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "Vendor", default)]
    pub vendor: String,
    #[serde(rename = "Version", default)]
    pub version: String,
    #[serde(rename = "Sub Categories", default)]
    pub sub_categories: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct ModuleInfoFactory {
    #[serde(rename = "Vendor", default)]
    pub vendor: String,
}

/// What a bundle's `moduleinfo.json` says about itself.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ModuleInfo {
    #[serde(rename = "Factory Info", default)]
    pub factory_info: ModuleInfoFactory,
    #[serde(rename = "Classes")]
    pub classes: Vec<ModuleInfoClass>,
}

/// The category string the format gives an audio processing class. A bundle
/// also lists its controller classes, and those are not plugins.
pub const AUDIO_MODULE_CLASS: &str = "Audio Module Class";

impl ModuleInfo {
    /// The bundle's audio module classes, in declared order.
    pub fn audio_module_classes(&self) -> impl Iterator<Item = &ModuleInfoClass> {
        self.classes
            .iter()
            .filter(|class| class.category == AUDIO_MODULE_CLASS)
    }
}

/// Parse a `moduleinfo.json` document.
pub fn parse_module_info(source: &str) -> Result<ModuleInfo, String> {
    let normalised = json5_to_json(source);
    serde_json::from_str(&normalised)
        .map_err(|error| format!("VST3 moduleinfo.json could not be read: {error}"))
}

/// Rewrite the two JSON5 extensions the format uses into plain JSON.
///
/// Comments become spaces rather than being deleted, so every byte offset in a
/// parse error still points at the same place in the caller's original text.
/// String literals are tracked because `"https://localhost"` contains what
/// looks exactly like a line comment.
pub fn json5_to_json(source: &str) -> String {
    let mut output = String::with_capacity(source.len());
    let mut characters = source.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;

    while let Some(character) = characters.next() {
        if in_string {
            output.push(character);
            // Whether *this* character is the one being escaped has to be read
            // before the flag is rewritten for the next one. Reading it after
            // makes the `"` of `"a\"b"` close the string, and the rest of the
            // document is then scanned inside-out — every real comment kept and
            // every quoted `//` blanked.
            let was_escaped = escaped;
            escaped = !was_escaped && character == '\\';
            if character == '"' && !was_escaped {
                in_string = false;
            }
            continue;
        }

        match character {
            '"' => {
                in_string = true;
                escaped = false;
                output.push(character);
            }
            // One space for the opening slash already taken off the iterator;
            // the helper blanks every remaining character of the comment,
            // including the second slash, one for one.
            '/' if characters.peek() == Some(&'/') => {
                output.push(' ');
                blank_until_line_end(&mut characters, &mut output);
            }
            '/' if characters.peek() == Some(&'*') => {
                output.push(' ');
                blank_until_block_end(&mut characters, &mut output);
            }
            _ => output.push(character),
        }
    }

    remove_trailing_commas(&output)
}

fn blank_until_line_end(
    characters: &mut std::iter::Peekable<std::str::Chars<'_>>,
    output: &mut String,
) {
    for character in characters.by_ref() {
        if character == '\n' {
            output.push('\n');
            return;
        }
        output.push(' ');
    }
}

fn blank_until_block_end(
    characters: &mut std::iter::Peekable<std::str::Chars<'_>>,
    output: &mut String,
) {
    // The `*` that opened the comment is taken off the iterator before the scan
    // begins, and `previous` starts as neither slash nor star. Letting the
    // opener's own star into the scan makes `/*/` look like a closed comment,
    // which ends it two characters in and spills the rest of the comment text
    // into the JSON as though it were data.
    let Some(opening_star) = characters.next() else {
        return;
    };
    output.push(if opening_star == '\n' { '\n' } else { ' ' });

    let mut previous = ' ';
    for character in characters.by_ref() {
        output.push(if character == '\n' { '\n' } else { ' ' });
        if previous == '*' && character == '/' {
            return;
        }
        previous = character;
    }
}

/// Drop a comma that is followed only by whitespace and a closing bracket.
///
/// Walks byte offsets into the original text rather than a `Vec<char>`: a
/// `moduleinfo.json` is bounded but not small, and collecting it into four bytes
/// per character to look one character ahead costs a second copy of the document
/// for nothing.
fn remove_trailing_commas(source: &str) -> String {
    let mut output = String::with_capacity(source.len());
    let mut in_string = false;
    let mut escaped = false;

    for (index, character) in source.char_indices() {
        if in_string {
            output.push(character);
            // As in `json5_to_json`: read the flag for this character before
            // rewriting it for the next.
            let was_escaped = escaped;
            escaped = !was_escaped && character == '\\';
            if character == '"' && !was_escaped {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            escaped = false;
            output.push(character);
            continue;
        }
        // `,` is one byte, so `index + 1` is a character boundary.
        if character == ',' && closes_next(&source[index + 1..]) {
            output.push(' ');
            continue;
        }
        output.push(character);
    }

    output
}

/// Whether the next thing in `rest` that is not whitespace closes an object or
/// an array.
fn closes_next(rest: &str) -> bool {
    rest.chars()
        .find(|next| !next.is_whitespace())
        .is_some_and(|next| next == '}' || next == ']')
}

#[cfg(test)]
mod tests {
    use super::*;

    const SDK_STYLE_DOCUMENT: &str = r#"{
// This file is generated by the VST3 SDK.
"Factory Info": {
    "Vendor": "Vendor Ltd",
    "URL": "https://localhost//not-a-comment",
},
"Classes": [
    {
        "CID": "1234567890ABCDEF1234567890ABCDEF",
        "Category": "Audio Module Class",
        "Name": "Big Reverb",
        "Vendor": "Vendor Ltd",
        "Version": "2.1.0",
        /* the routing category the browser reads */
        "Sub Categories": [ "Fx", "Reverb", ],
    },
    {
        "CID": "FEDCBA0987654321FEDCBA0987654321",
        "Category": "Component Controller Class",
        "Name": "Big Reverb Controller"
    },
]
}"#;

    /// The SDK's own generator emits comments and trailing commas, and
    /// `serde_json` rejects both — so a host that hands it the file verbatim
    /// reads no real bundle's description at all.
    #[test]
    fn a_real_sdk_document_parses_despite_comments_and_trailing_commas() {
        assert!(
            serde_json::from_str::<ModuleInfo>(SDK_STYLE_DOCUMENT).is_err(),
            "this document is JSON5; if plain JSON accepted it the normalisation would be untested"
        );

        let info = parse_module_info(SDK_STYLE_DOCUMENT).expect("a JSON5 document should parse");

        assert_eq!(info.factory_info.vendor, "Vendor Ltd");
        assert_eq!(info.classes.len(), 2);
    }

    /// A URL contains `//`. Treating it as a line comment truncates the
    /// document and every parse fails.
    #[test]
    fn a_double_slash_inside_a_string_is_not_a_comment() {
        let info = parse_module_info(SDK_STYLE_DOCUMENT).expect("a JSON5 document should parse");

        assert_eq!(info.classes[0].name, "Big Reverb");
    }

    /// A bundle lists its controller classes beside its plugins. Enumerating
    /// both would advertise a controller as something a user can load.
    #[test]
    fn only_audio_module_classes_are_plugins() {
        let info = parse_module_info(SDK_STYLE_DOCUMENT).expect("a JSON5 document should parse");

        let audio_classes: Vec<&str> = info
            .audio_module_classes()
            .map(|class| class.name.as_str())
            .collect();

        assert_eq!(audio_classes, vec!["Big Reverb"]);
    }

    #[test]
    fn a_class_carries_the_routing_sub_categories() {
        let info = parse_module_info(SDK_STYLE_DOCUMENT).expect("a JSON5 document should parse");

        assert_eq!(
            info.classes[0].sub_categories,
            vec!["Fx".to_string(), "Reverb".to_string()]
        );
    }

    #[test]
    fn a_block_comment_between_entries_is_removed() {
        let document = r#"{ "Classes": [ /* nothing */ ] }"#;

        assert_eq!(
            parse_module_info(document).expect("a JSON5 document should parse"),
            ModuleInfo {
                factory_info: ModuleInfoFactory::default(),
                classes: Vec::new(),
            }
        );
    }

    /// An unreadable description is not a description. Refusing lets the caller
    /// fall back to loading the module rather than publishing an empty bundle.
    #[test]
    fn an_unparseable_document_is_refused_rather_than_read_as_empty() {
        assert!(parse_module_info("not json at all").is_err());
        assert!(parse_module_info(r#"{ "Classes": "one" }"#).is_err());
    }

    /// An escaped quote does not end a string. Reading it as one puts the
    /// scanner inside-out for the rest of the document: real comments survive
    /// into the JSON and quoted text is blanked as though it were a comment.
    #[test]
    fn an_escaped_quote_does_not_end_the_string_it_is_inside() {
        let document =
            r#"{ "Classes": [ { "CID": "a\"b//c", "Category": "Audio Module Class" } ] }"#;

        let info = parse_module_info(document).expect("a JSON5 document should parse");

        assert_eq!(
            info.classes[0].cid, "a\"b//c",
            "the `//` inside the string was read as a comment"
        );
    }

    /// The same bug seen from the other side: the trailing-comma pass has its own
    /// string scanner, and a comma inside a string must never be dropped.
    #[test]
    fn a_comma_inside_a_string_with_an_escaped_quote_survives() {
        let document = r#"{ "Classes": [ { "CID": "a\"b", "Category": "Audio Module Class", "Name": "x, y" } ] }"#;

        let info = parse_module_info(document).expect("a JSON5 document should parse");

        assert_eq!(info.classes[0].name, "x, y");
    }

    /// `/*/` is an unterminated block comment: the `*` belongs to the opener and
    /// cannot also close it. Reading it as closed ends the comment two characters
    /// in and spills its text into the document.
    #[test]
    fn a_block_comment_is_not_closed_by_the_star_that_opened_it() {
        let document = r#"{ /*/ "Classes": [ { "CID": "commented out" } ] */ "Classes": [] }"#;

        let normalised = json5_to_json(document);

        assert!(
            !normalised.contains("CID"),
            "the comment ended on its own opening star and its text reached the JSON: {normalised}"
        );
        assert!(parse_module_info(document)
            .expect("one comment, then one Classes key")
            .classes
            .is_empty());
    }

    /// Blanking rather than deleting keeps every later byte at the offset the
    /// caller's own file has, so a parse error points at the right place.
    #[test]
    fn normalisation_preserves_the_length_of_the_document() {
        let normalised = json5_to_json(SDK_STYLE_DOCUMENT);

        assert_eq!(
            normalised.chars().count(),
            SDK_STYLE_DOCUMENT.chars().count()
        );
    }
}
