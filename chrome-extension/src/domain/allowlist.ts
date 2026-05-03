/**
 * Domain allowlist — pure glob-pattern hostname matching.
 *
 * Zero Chrome API dependencies. Zero DOM dependencies.
 * Fully testable in any JS runtime (Node, Bun, happy-dom, browser).
 *
 * @module domain/allowlist
 */

/**
 * Convert a glob-style domain pattern to a case-insensitive RegExp.
 *
 * - `*` matches a single subdomain label (one or more non-dot characters).
 * - `?` matches exactly one non-dot character.
 * - All other regex-special characters are escaped literally.
 *
 * @example
 *   globToRegex("*.example.com")  // → /^[^.]+\.example\.com$/i
 *   globToRegex("example.com")    // → /^example\.com$/i
 */
export function globToRegex(pattern: string): RegExp {
	let regex = "";
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern.charAt(i);
		if (ch === "*") {
			// Match a single subdomain label — one or more non-dot characters.
			regex += "[^.]+";
		} else if (ch === "?") {
			regex += "[^.]";
		} else if (".^$+={}[]|\\()".includes(ch)) {
			regex += `\\${ch}`;
		} else {
			regex += ch;
		}
	}
	return new RegExp(`^${regex}$`, "i");
}

/**
 * Test whether a hostname matches any glob pattern in a list.
 *
 * The literal pattern `"*"` matches every hostname (allow-all sentinel).
 * Lines starting with `#` are treated as comments and skipped.
 * Whitespace-only entries are ignored.
 *
 * @returns `true` if the hostname matches at least one pattern.
 */
export function matchDomain(hostname: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		const trimmed = pattern.trim();
		if (trimmed === "") continue;
		if (trimmed === "*") return true;
		// Skip comment lines (optional UX nicety in the textarea).
		if (trimmed.startsWith("#")) continue;
		if (globToRegex(trimmed).test(hostname)) return true;
	}
	return false;
}
