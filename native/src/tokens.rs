use unicode_general_category::{GeneralCategory, get_general_category};

/// Match Bonsai's existing scanner metric, not a count of AST nodes.
/// Unsupported lexical forms return an error instead of discounted retained cost.
pub fn count(text: &str, typescript: bool) -> Result<u64, String> {
    if !typescript {
        return Ok(plain(text));
    }
    let mut cursor = 0;
    let mut total = 0;
    let bytes = text.as_bytes();
    while cursor < bytes.len() {
        let rest = &text[cursor..];
        let character = rest.chars().next().unwrap();
        if scanner_space(character) {
            cursor += character.len_utf8();
            continue;
        }
        if cursor == 0 && rest.starts_with("#!") {
            cursor = line_end(text, cursor);
            total += 1; // TypeScript treats shebang trivia as one token.
            continue;
        }
        if rest.starts_with("//") {
            let end = line_end(text, cursor);
            total += plain(&text[cursor..end]);
            cursor = end;
            continue;
        }
        if rest.starts_with("/*") {
            let end = rest
                .find("*/")
                .map(|offset| cursor + offset + 2)
                .ok_or_else(|| "Unterminated block comment in native token metric".to_string())?;
            total += plain(&text[cursor..end]);
            cursor = end;
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            let end = literal_end(text, cursor, character)?;
            total += ((end - cursor) as u64).div_ceil(4).max(1);
            cursor = end;
            continue;
        }
        if identifier_start(character)
            || (character == '#' && rest[1..].chars().next().is_some_and(identifier_start))
        {
            cursor += character.len_utf8();
            while cursor < bytes.len() {
                let next = text[cursor..].chars().next().unwrap();
                if !identifier_continue(next) {
                    break;
                }
                cursor += next.len_utf8();
            }
            total += 1;
            continue;
        }
        if character.is_ascii_digit()
            || (character == '.' && bytes.get(cursor + 1).is_some_and(u8::is_ascii_digit))
        {
            cursor = number_end(bytes, cursor);
            total += 1;
            continue;
        }
        // A plain ts.Scanner does not re-scan greater-than operators. `>>=` is
        // three tokens, unlike `<<=`. Preserve that accounting deliberately.
        let operator = [
            "===", "!==", "**=", "&&=", "||=", "??=", "<<=", "...", "==", "!=", "**", "++", "--",
            "&&", "||", "??", "<=", "<<", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "=>",
        ]
        .into_iter()
        .find(|operator| rest.starts_with(operator));
        if let Some(operator) = operator {
            cursor += operator.len();
        } else if rest.starts_with("?.") && !bytes.get(cursor + 2).is_some_and(u8::is_ascii_digit) {
            cursor += 2;
        } else if "{}()[];,.?:~+-*/%&|^!<>=@#".contains(character) {
            cursor += character.len_utf8();
        } else {
            return Err(format!(
                "Unsupported native token metric character {character:?} at byte {cursor}"
            ));
        }
        total += 1;
    }
    Ok(total)
}

fn plain(text: &str) -> u64 {
    let mut total = 0;
    let mut word = false;
    for character in text.chars() {
        let next_word = character == '_'
            || matches!(
                get_general_category(character),
                GeneralCategory::UppercaseLetter
                    | GeneralCategory::LowercaseLetter
                    | GeneralCategory::TitlecaseLetter
                    | GeneralCategory::ModifierLetter
                    | GeneralCategory::OtherLetter
                    | GeneralCategory::DecimalNumber
                    | GeneralCategory::LetterNumber
                    | GeneralCategory::OtherNumber
            );
        if next_word {
            if !word {
                total += 1;
            }
        } else if !ecma_space(character) {
            total += 1;
        }
        word = next_word;
    }
    total
}

fn ecma_space(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{000b}' | '\u{000c}' | '\r' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn scanner_space(character: char) -> bool {
    // ts.Scanner additionally skips NEL and zero-width space. JS \s does not.
    ecma_space(character) || matches!(character, '\u{0085}' | '\u{200b}')
}

fn identifier_start(character: char) -> bool {
    matches!(character, '$' | '_')
        || (identifier_range(character) && unicode_ident::is_xid_start(character))
        || matches!(
            character,
            '\u{1885}' | '\u{1886}' | '\u{2118}' | '\u{212e}' | '\u{309b}' | '\u{309c}'
        )
}

fn identifier_continue(character: char) -> bool {
    matches!(character, '$' | '\u{00b7}' | '\u{200c}' | '\u{200d}')
        || (identifier_range(character) && unicode_ident::is_xid_continue(character))
        || matches!(character, '\u{309b}' | '\u{309c}')
}

fn identifier_range(character: char) -> bool {
    // Keep identifier support to stable Unicode blocks shared by the pinned
    // TypeScript scanner and Rust tables. Other identifiers need explicit parity
    // coverage; strings, comments and non-TypeScript text retain all Unicode.
    character.is_ascii()
        || matches!(character, '\u{00c0}'..='\u{052f}' | '\u{3040}'..='\u{30ff}' | '\u{4e00}'..='\u{9fff}')
}

fn line_end(text: &str, start: usize) -> usize {
    text[start..]
        .char_indices()
        .find(|(_, character)| matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
        .map_or(text.len(), |(offset, _)| start + offset)
}

fn literal_end(text: &str, start: usize, quote: char) -> Result<usize, String> {
    let mut cursor = start + 1;
    while cursor < text.len() {
        let rest = &text[cursor..];
        let character = rest.chars().next().unwrap();
        if character == quote {
            return Ok(cursor + 1);
        }
        if quote == '`' && rest.starts_with("${") {
            return Err(
                "Template interpolation requires a native token metric adapter".to_string(),
            );
        }
        if character == '\\' {
            cursor += 1;
            let escaped = text[cursor..]
                .chars()
                .next()
                .ok_or_else(|| "Unterminated escape in native token metric".to_string())?;
            cursor += escaped.len_utf8();
            if escaped == '\r' && text.as_bytes().get(cursor) == Some(&b'\n') {
                cursor += 1;
            }
        } else {
            if quote != '`' && matches!(character, '\r' | '\n') {
                return Err("Unterminated string in native token metric".to_string());
            }
            cursor += character.len_utf8();
        }
    }
    Err("Unterminated literal in native token metric".to_string())
}

fn number_end(bytes: &[u8], start: usize) -> usize {
    let mut cursor = start;
    if bytes.get(start) == Some(&b'0') {
        let radix = match bytes.get(start + 1) {
            Some(b'x' | b'X') => Some(16),
            Some(b'b' | b'B') => Some(2),
            Some(b'o' | b'O') => Some(8),
            _ => None,
        };
        if let Some(radix) = radix {
            cursor += 2;
            while bytes
                .get(cursor)
                .is_some_and(|byte| *byte == b'_' || (*byte as char).is_digit(radix))
            {
                cursor += 1;
            }
            if bytes.get(cursor) == Some(&b'n') {
                cursor += 1;
            }
            return cursor;
        }
    }
    while bytes
        .get(cursor)
        .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'_')
    {
        cursor += 1;
    }
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'_')
        {
            cursor += 1;
        }
    }
    if matches!(bytes.get(cursor), Some(b'e' | b'E')) {
        cursor += 1;
        if matches!(bytes.get(cursor), Some(b'+' | b'-')) {
            cursor += 1;
        }
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'_')
        {
            cursor += 1;
        }
    }
    if bytes.get(cursor) == Some(&b'n') {
        cursor += 1;
    }
    cursor
}

#[cfg(test)]
mod tests {
    use super::count;

    #[test]
    fn literal_payload_comments_and_unicode_match_reference_vectors() {
        for (text, expected) in [
            ("const x = 1;", 5),
            ("const x=\"abcd\";", 6),
            ("const t=`hello`", 5),
            ("// hello 世界 e\u{0301} ²\n/* x */ const s=\"ééé\"", 17),
            ("#! /usr/bin/env bun\nconst x=1", 5),
            ("const café=\"🥰\";", 6),
            ("const κόσμος = 中文 + café;", 7),
            ("const s=\"a\\\r\nb\"", 5),
        ] {
            assert_eq!(count(text, true), Ok(expected), "{text:?}");
        }
        assert_eq!(count("e\u{0301} ² _thing \u{feff}\u{0085}", false), Ok(5));
    }

    #[test]
    fn scanner_operators_and_numeric_literals_keep_existing_accounting() {
        for (text, expected) in [
            ("a >> b >>> c >= d >>= e >>>= f", 20),
            ("a << b <<= c", 5),
            ("#name @foo", 3),
            ("a?.b ?? c **= 2", 7),
            ("a?.2:3", 5),
            ("a / b /= c", 5),
            ("const re=/ab+/g", 8),
            ("0xFFn .5 1e+2", 3),
            ("const n=12.34e-2; const m=0xFF; const k=1_000n", 14),
        ] {
            assert_eq!(count(text, true), Ok(expected), "{text:?}");
        }
    }

    #[test]
    fn uncertain_lexical_forms_fail_closed() {
        for text in [
            "const t=`a${x}b`",
            "const t=\"unfinished",
            "/* unfinished",
            "foo\\u0061",
            "/\\w+/g",
            "const देवनागरी = 1",
        ] {
            assert!(count(text, true).is_err(), "{text:?}");
        }
    }
}
