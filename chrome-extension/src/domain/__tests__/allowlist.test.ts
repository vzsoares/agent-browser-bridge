/**
 * Domain allowlist tests — globToRegex and matchDomain.
 *
 * Tests the pure string-matching functions with no DOM or Chrome API
 * dependencies.
 *
 * @module domain/__tests__/allowlist.test
 */

import { describe, expect, test } from "vitest";
import { globToRegex, matchDomain } from "../allowlist.js";

describe("globToRegex", () => {
	test("exact hostname match", () => {
		const re = globToRegex("example.com");
		expect(re.test("example.com")).toBe(true);
		expect(re.test("sub.example.com")).toBe(false);
	});

	test("wildcard matches a single subdomain label", () => {
		const re = globToRegex("*.example.com");
		expect(re.test("sub.example.com")).toBe(true);
		expect(re.test("multi.sub.example.com")).toBe(false);
		expect(re.test("example.com")).toBe(false);
	});

	test("question mark matches a single non-dot character", () => {
		const re = globToRegex("ex?mple.com");
		expect(re.test("example.com")).toBe(true);
		expect(re.test("exymple.com")).toBe(true);
		expect(re.test("exmple.com")).toBe(false);
	});

	test("case-insensitive", () => {
		const re = globToRegex("Example.COM");
		expect(re.test("example.com")).toBe(true);
		expect(re.test("EXAMPLE.COM")).toBe(true);
		expect(re.test("Example.Com")).toBe(true);
	});

	test("special regex characters are escaped", () => {
		const re = globToRegex("test.example+.com");
		expect(re.test("test.example+.com")).toBe(true);
		expect(re.test("test.exampleX.com")).toBe(false);

		const re2 = globToRegex("test.[example].com");
		expect(re2.test("test.[example].com")).toBe(true);
		expect(re2.test("test.example.com")).toBe(false);
	});

	test("multiple wildcards", () => {
		const re = globToRegex("*.*.com");
		expect(re.test("a.b.com")).toBe(true);
		expect(re.test("a.b.c.com")).toBe(false);
	});
});

describe("matchDomain", () => {
	test("empty patterns return false", () => {
		expect(matchDomain("example.com", [])).toBe(false);
		expect(matchDomain("example.com", [""])).toBe(false);
		expect(matchDomain("example.com", ["  "])).toBe(false);
	});

	test("allow-all sentinel (*) matches everything", () => {
		expect(matchDomain("anything.example.com", ["*"])).toBe(true);
		expect(matchDomain("localhost", ["*"])).toBe(true);
		expect(matchDomain("", ["*"])).toBe(true);
	});

	test("exact hostname match", () => {
		expect(matchDomain("example.com", ["example.com"])).toBe(true);
		expect(matchDomain("sub.example.com", ["example.com"])).toBe(false);
	});

	test("wildcard subdomain match", () => {
		expect(matchDomain("sub.example.com", ["*.example.com"])).toBe(true);
		expect(matchDomain("deep.sub.example.com", ["*.example.com"])).toBe(false);
	});

	test("comment lines (starting with #) are skipped", () => {
		expect(
			matchDomain("example.com", ["# this is a comment", "example.com"]),
		).toBe(true);
		expect(matchDomain("example.com", ["#example.com"])).toBe(false);
	});

	test("first matching pattern wins", () => {
		expect(
			matchDomain("example.com", ["invalid.com", "example.com", "other.com"]),
		).toBe(true);
		expect(matchDomain("example.com", ["*.example.com"])).toBe(false);
	});

	test("sentinel matched before comments", () => {
		expect(
			matchDomain("any.domain", ["# not a wildcard", "*", "# another comment"]),
		).toBe(true);
	});

	test("multiple patterns", () => {
		const patterns = ["*.google.com", "*.github.com", "example.org"];
		expect(matchDomain("www.google.com", patterns)).toBe(true);
		expect(matchDomain("api.github.com", patterns)).toBe(true);
		expect(matchDomain("example.org", patterns)).toBe(true);
		expect(matchDomain("random.com", patterns)).toBe(false);
	});
});
