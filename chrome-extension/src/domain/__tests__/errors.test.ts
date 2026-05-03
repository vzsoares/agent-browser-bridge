/**
 * Domain error factory tests.
 *
 * Tests the pure factory functions that produce DomainError objects.
 *
 * @module domain/__tests__/errors.test
 */

import { describe, expect, test } from "vitest";
import {
	elementNotFoundError,
	elementNotInteractableError,
	elementNotTypableError,
	timeoutError,
} from "../errors.js";

describe("timeoutError", () => {
	test("creates a TIMEOUT error with message", () => {
		const err = timeoutError("Operation timed out");
		expect(err.code).toBe("TIMEOUT");
		expect(err.message).toBe("Operation timed out");
		expect(err.suggestion).toBeUndefined();
	});

	test("creates a TIMEOUT error with optional suggestion", () => {
		const err = timeoutError("Operation timed out", "Try increasing the timeout");
		expect(err.code).toBe("TIMEOUT");
		expect(err.message).toBe("Operation timed out");
		expect(err.suggestion).toBe("Try increasing the timeout");
	});
});

describe("elementNotFoundError", () => {
	test("creates an ELEMENT_NOT_FOUND error with message", () => {
		const err = elementNotFoundError("No element matching #foo");
		expect(err.code).toBe("ELEMENT_NOT_FOUND");
		expect(err.message).toBe("No element matching #foo");
		expect(err.suggestion).toBeUndefined();
	});

	test("creates an ELEMENT_NOT_FOUND error with suggestion", () => {
		const err = elementNotFoundError(
			"Element missing",
			"Check the selector spelling",
		);
		expect(err.code).toBe("ELEMENT_NOT_FOUND");
		expect(err.suggestion).toBe("Check the selector spelling");
	});
});

describe("elementNotInteractableError", () => {
	test("creates an ELEMENT_NOT_INTERACTABLE error", () => {
		const err = elementNotInteractableError(
			"Element is hidden or disabled",
		);
		expect(err.code).toBe("ELEMENT_NOT_INTERACTABLE");
		expect(err.message).toBe("Element is hidden or disabled");
	});

	test("creates an ELEMENT_NOT_INTERACTABLE error with suggestion", () => {
		const err = elementNotInteractableError(
			"Element is disabled",
			"Wait for the element to become enabled",
		);
		expect(err.code).toBe("ELEMENT_NOT_INTERACTABLE");
		expect(err.suggestion).toBe("Wait for the element to become enabled");
	});
});

describe("elementNotTypableError", () => {
	test("creates an ELEMENT_NOT_TYPABLE error", () => {
		const err = elementNotTypableError("Element <div> is not typable");
		expect(err.code).toBe("ELEMENT_NOT_TYPABLE");
		expect(err.message).toBe("Element <div> is not typable");
	});

	test("creates an ELEMENT_NOT_TYPABLE error with suggestion", () => {
		const err = elementNotTypableError(
			"Not an input element",
			"Use a selector targeting an <input> or <textarea>",
		);
		expect(err.code).toBe("ELEMENT_NOT_TYPABLE");
		expect(err.suggestion).toContain("<input>");
	});
});
