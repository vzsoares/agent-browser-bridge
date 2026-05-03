/**
 * URL and domain allowlist validation logic.
 *
 * Enforces security restrictions on which URLs can be navigated to and
 * screenshotted. Extracted from the tool handlers so it can be reused
 * consistently across all tools that accept URLs.
 *
 * Zero dependencies on infrastructure packages (Hono, ws, pi SDK).
 * Only imports: protocol types.
 *
 * @module domain/allowlist
 */

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * URL schemes that are blocked from navigation and screenshot.
 * Mirrors the regex in the Chrome extension's service worker.
 */
export const RESTRICTED_URL_RE = /^(chrome|chrome-extension|edge|brave|about):\/\//i;

/**
 * Well-known blocked schemes (for error messaging).
 */
export const RESTRICTED_SCHEMES = [
  "chrome",
  "chrome-extension",
  "edge",
  "brave",
  "about",
] as const;

// ── Result types ───────────────────────────────────────────────────────────

/** Successful URL validation result. */
export interface UrlValid {
  valid: true;
  /** Normalised URL object. */
  url: URL;
}

/** Failed URL validation result. */
export interface UrlInvalid {
  valid: false;
  code: "INVALID_URL" | "RESTRICTED_URL";
  message: string;
  suggestion?: string;
}

export type UrlValidation = UrlValid | UrlInvalid;

/** Successful domain check result. */
export interface DomainAllowed {
  allowed: true;
}

/** Failed domain check result. */
export interface DomainBlocked {
  allowed: false;
  code: "RESTRICTED_DOMAIN";
  message: string;
  suggestion?: string;
}

export type DomainCheck = DomainAllowed | DomainBlocked;

// ── URL validation ─────────────────────────────────────────────────────────

/**
 * Validate a URL string against format and security constraints.
 *
 * Checks:
 * 1. URL is parseable (well-formed)
 * 2. URL does not use a restricted scheme (chrome://, edge://, etc.)
 *
 * @returns A discriminated union — check `.valid` before accessing `.url`.
 */
export function validateUrl(url: string): UrlValidation {
  // ── Format check ──────────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      valid: false,
      code: "INVALID_URL",
      message: `Invalid URL format: "${url}"`,
      suggestion:
        "Provide a fully-qualified URL like https://example.com or https://example.com/path.",
    };
  }

  // ── Scheme restrictions ───────────────────────────────────────────────
  if (RESTRICTED_URL_RE.test(parsed.href)) {
    const scheme = parsed.protocol.replace(/:$/, "");
    return {
      valid: false,
      code: "RESTRICTED_URL",
      message: `Navigation to "${scheme}://" URLs is blocked for security reasons.`,
      suggestion: "Use https:// URLs for web pages.",
    };
  }

  return { valid: true, url: parsed };
}

/**
 * Extract the hostname from a URL for allowlist comparison.
 * Returns `null` if the URL is not parseable.
 */
export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ── Allowlist matching ─────────────────────────────────────────────────────

/**
 * Check whether a domain is allowed by the configured allowlist.
 *
 * ## Allowlist rules
 *
 * - `"*"` (wildcard) → all domains are allowed.
 * - `"example.com"` → exact match (also matches `sub.example.com`).
 * - `"*.example.com"` → matches `example.com` and any subdomain.
 * - An empty allowlist means nothing is allowed (except `localhost`).
 *
 * `localhost` is always implicitly allowed for development convenience.
 *
 * @param hostname — The hostname to check (e.g. `"example.com"`).
 * @param allowlist — The configured list of allowed patterns.
 * @returns A discriminated union — check `.allowed` before proceeding.
 */
export function checkDomain(
  hostname: string,
  allowlist: readonly string[],
): DomainCheck {
  // Always allow localhost for development
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { allowed: true };
  }

  // Wildcard: allow everything
  if (allowlist.includes("*")) {
    return { allowed: true };
  }

  // Empty allowlist: nothing allowed
  if (allowlist.length === 0) {
    return {
      allowed: false,
      code: "RESTRICTED_DOMAIN",
      message: `Domain "${hostname}" is not allowed.`,
      suggestion: "Add domains to the allowlist in the extension popup, or set the allowlist to '*' to allow all.",
    };
  }

  // Check each pattern
  for (const pattern of allowlist) {
    if (matchesDomainPattern(hostname, pattern)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    code: "RESTRICTED_DOMAIN",
    message: `Domain "${hostname}" is not in the configured allowlist.`,
    suggestion:
      "Add this domain to the allowlist in the extension popup, or set the allowlist to '*' to allow all.",
  };
}

/**
 * Check whether a hostname matches a single allowlist pattern.
 *
 * Patterns:
 * - `"example.com"` — exact match, also matches `sub.example.com`.
 * - `"*.example.com"` — matches `example.com` and `*.example.com`.
 * - `"*"` — matches everything (handled by caller).
 */
function matchesDomainPattern(hostname: string, pattern: string): boolean {
  // Wildcard prefix: *.example.com matches example.com and sub.example.com
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2); // "example.com"
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  // Exact or suffix match: example.com matches example.com and sub.example.com
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}
