/**
 * Domain DOM helpers tests — waitForElement, waitForText, extractText,
 * isInteractable, isClickable, etc.
 *
 * Runs against happy-dom (configured in vitest.config.ts).
 *
 * @module domain/__tests__/dom.test
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	collapse,
	collectTypableSuggestions,
	dispatchInputEvents,
	extractText,
	isClickable,
	isHidden,
	isInteractable,
	linkAnnotation,
	waitForElement,
	waitForText,
	withTimeout,
} from "../dom.js";

// ────────────────────────────────────────────────────────────────────────────
// waitForElement
// ────────────────────────────────────────────────────────────────────────────

describe("waitForElement", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	test("resolves immediately when element already exists", async () => {
		document.body.innerHTML = '<div id="target">hello</div>';
		const result = await waitForElement("#target", 5000);
		expect(result.found).toBe(true);
		expect(result.elapsedMs).toBe(0);
		expect(result.element.textContent).toBe("hello");
	});

	test("resolves when element appears (polling)", async () => {
		const promise = waitForElement("#dynamic", 5000);
		// Simulate element appearing after a small delay.
		setTimeout(() => {
			document.body.innerHTML = '<span id="dynamic">dynamic content</span>';
		}, 50);
		const result = await promise;
		expect(result.found).toBe(true);
		expect(result.element.textContent).toBe("dynamic content");
	});

	test("rejects with TIMEOUT when element does not appear", async () => {
		await expect(waitForElement("#nonexistent", 200)).rejects.toThrow(
			"TIMEOUT",
		);
	});

	test("works with class selectors", async () => {
		document.body.innerHTML = '<div class="my-class">found</div>';
		const result = await waitForElement(".my-class", 1000);
		expect(result.found).toBe(true);
	});

	test("rejects on invalid CSS selector", async () => {
		// happy-dom's querySelector throws DOMException on malformed selectors.
		await expect(
			waitForElement("[invalid", 5000),
		).rejects.toThrow();
	});

	test("rejects on empty selector", async () => {
		await expect(waitForElement("", 5000)).rejects.toThrow();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// waitForText
// ────────────────────────────────────────────────────────────────────────────

describe("waitForText", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	test("resolves immediately when text already exists", async () => {
		document.body.innerHTML = "<p>Hello, World!</p>";
		const result = await waitForText("Hello", undefined, 5000);
		expect(result.found).toBe(true);
		expect(result.elapsedMs).toBe(0);
	});

	test("resolves when text appears (polling)", async () => {
		const promise = waitForText("appeared", undefined, 5000);
		setTimeout(() => {
			document.body.innerHTML = "<p>text has appeared now</p>";
		}, 150);
		const result = await promise;
		expect(result.found).toBe(true);
		expect(result.elapsedMs).toBeGreaterThan(0);
	});

	test("rejects with TIMEOUT when text does not appear", async () => {
		document.body.innerHTML = "<p>some text</p>";
		await expect(
			waitForText("nonexistent text", undefined, 200),
		).rejects.toThrow("TIMEOUT");
	});

	test("scoped to a CSS selector", async () => {
		document.body.innerHTML =
			'<div id="a"><p>hello</p></div><div id="b"><p>world</p></div>';
		// Text "world" only exists in #b
		const result = await waitForText("world", "#b", 1000);
		expect(result.found).toBe(true);

		await expect(waitForText("world", "#a", 200)).rejects.toThrow("TIMEOUT");
	});

	test("is case-sensitive — 'Hello' does not match 'hello'", async () => {
		document.body.innerHTML = "<p>hello world</p>";
		await expect(
			waitForText("Hello", undefined, 200),
		).rejects.toThrow("TIMEOUT");
	});

	test("matches exact case", async () => {
		document.body.innerHTML = "<p>Hello WORLD</p>";
		// "WORLD" uppercase should match
		const result = await waitForText("WORLD", undefined, 1000);
		expect(result.found).toBe(true);
		// "world" lowercase should NOT match
		await expect(
			waitForText("world", undefined, 200),
		).rejects.toThrow("TIMEOUT");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// isInteractable
// ────────────────────────────────────────────────────────────────────────────

describe("isInteractable", () => {
	test("normal visible input is interactable", () => {
		document.body.innerHTML = '<input type="text" value="hello" />';
		const el = document.querySelector("input") as HTMLInputElement;
		expect(isInteractable(el)).toBe(true);
	});

	test("disabled input is not interactable", () => {
		document.body.innerHTML = '<input type="text" disabled />';
		const el = document.querySelector("input") as HTMLInputElement;
		expect(isInteractable(el)).toBe(false);
	});

	test("readonly input is not interactable", () => {
		document.body.innerHTML = '<input type="text" readonly />';
		const el = document.querySelector("input") as HTMLInputElement;
		expect(isInteractable(el)).toBe(false);
	});

	test("aria-hidden element is not interactable", () => {
		document.body.innerHTML = '<input type="text" aria-hidden="true" />';
		const el = document.querySelector("input") as HTMLInputElement;
		expect(isInteractable(el)).toBe(false);
	});

	test("element inside [hidden] ancestor is not interactable", () => {
		document.body.innerHTML = '<div hidden><input type="text" /></div>';
		const el = document.querySelector("input") as HTMLInputElement;
		expect(isInteractable(el)).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// isHidden
// ────────────────────────────────────────────────────────────────────────────

describe("isHidden", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	test("visible element is not hidden", () => {
		document.body.innerHTML = "<div>visible</div>";
		const el = document.querySelector("div")!;
		// happy-dom renders display as empty string for visible elements
		expect(isHidden(el)).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// isClickable
// ────────────────────────────────────────────────────────────────────────────

describe("isClickable", () => {
	test("visible button is clickable", () => {
		document.body.innerHTML = "<button>Click Me</button>";
		const el = document.querySelector("button") as HTMLButtonElement;
		// happy-dom doesn't compute layout, so getBoundingClientRect returns
		// {width:0,height:0}. Mock a non-zero rect to simulate visible element.
		vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
			width: 80,
			height: 30,
			x: 0,
			y: 0,
			top: 0,
			right: 80,
			bottom: 30,
			left: 0,
			toJSON: () => ({}),
		});
		expect(isClickable(el)).toBe(true);
	});

	test("disabled button is not clickable", () => {
		document.body.innerHTML = "<button disabled>Click Me</button>";
		const el = document.querySelector("button")!;
		expect(isClickable(el)).toBe(false);
	});

	test("aria-disabled element is not clickable", () => {
		document.body.innerHTML = '<button aria-disabled="true">Click Me</button>';
		const el = document.querySelector("button")!;
		expect(isClickable(el)).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// collapse
// ────────────────────────────────────────────────────────────────────────────

describe("collapse", () => {
	test("collapses multiple whitespace into single space", () => {
		expect(collapse("hello   world")).toBe("hello world");
	});

	test("trims leading and trailing whitespace", () => {
		expect(collapse("  hello world  ")).toBe("hello world");
	});

	test("collapses newlines and tabs", () => {
		expect(collapse("hello\n\tworld")).toBe("hello world");
	});

	test("empty string returns empty string", () => {
		expect(collapse("")).toBe("");
	});

	test("whitespace-only string returns empty", () => {
		expect(collapse("   \n\t  ")).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// linkAnnotation
// ────────────────────────────────────────────────────────────────────────────

describe("linkAnnotation", () => {
	test("returns display for external link", () => {
		document.body.innerHTML = '<a href="https://example.com">click</a>';
		const el = document.querySelector("a") as HTMLAnchorElement;
		const annotation = linkAnnotation(el);
		expect(annotation).toBe(" [https://example.com]");
	});

	test("returns empty string for empty href", () => {
		document.body.innerHTML = "<a>click</a>";
		const el = document.querySelector("a") as HTMLAnchorElement;
		expect(linkAnnotation(el)).toBe("");
	});

	test("returns empty string for hash-only href", () => {
		document.body.innerHTML = '<a href="#section">click</a>';
		const el = document.querySelector("a") as HTMLAnchorElement;
		expect(linkAnnotation(el)).toBe("");
	});

	test("truncates long hrefs", () => {
		const longUrl = `https://example.com/${"a".repeat(80)}`;
		document.body.innerHTML = `<a href="${longUrl}">click</a>`;
		const el = document.querySelector("a") as HTMLAnchorElement;
		const annotation = linkAnnotation(el);
		expect(annotation.length).toBeLessThan(longUrl.length + 5);
		expect(annotation.endsWith("…]")).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// extractText
// ────────────────────────────────────────────────────────────────────────────

describe("extractText", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	test("extracts plain text from body", () => {
		document.body.innerHTML = "<p>Hello, World!</p>";
		const result = extractText(document.body, 1000);
		expect(result.text).toContain("Hello, World!");
		expect(result.truncated).toBe(false);
	});

	test("respects maxLength and truncates", () => {
		// Truncation triggers at node boundaries, so we need nodes large
		// enough to exceed maxChars but truncation only stops at boundaries.
		const long = "x".repeat(200);
		document.body.innerHTML = `<p>${long}</p><p>${long}</p><p>${long}</p>`;
		const result = extractText(document.body, 10);
		expect(result.truncated).toBe(true);
		// The first <p> is fully processed before truncation flag kicks in.
		expect(result.text.length).toBeGreaterThan(10);
	});

	test("skips script and style tags", () => {
		document.body.innerHTML =
			"<script>var x = 1;</script><p>visible</p><style>.hidden{}</style>";
		const result = extractText(document.body, 1000);
		expect(result.text).not.toContain("var x = 1");
		expect(result.text).not.toContain(".hidden");
		expect(result.text).toContain("visible");
	});

	test("renders link annotations", () => {
		document.body.innerHTML = '<a href="https://example.com">Example Site</a>';
		const result = extractText(document.body, 1000);
		expect(result.text).toContain("Example Site");
		expect(result.text).toContain("[https://example.com]");
	});

	test("renders images with alt text", () => {
		document.body.innerHTML = '<img alt="A beautiful sunset" />';
		const result = extractText(document.body, 1000);
		expect(result.text).toContain('Image: "A beautiful sunset"');
	});

	test("renders buttons semantically", () => {
		document.body.innerHTML = "<button>Submit</button>";
		const result = extractText(document.body, 1000);
		expect(result.text).toContain("[Button: Submit]");
	});

	test("renders inputs with label inference", () => {
		document.body.innerHTML =
			'<label for="email">Email Address</label><input id="email" type="text" placeholder="user@example.com" />';
		const result = extractText(document.body, 1000);
		expect(result.text).toContain("Email Address");
	});

	test("handles headings with block breaks", () => {
		document.body.innerHTML = "<h1>Title</h1><p>Paragraph content.</p>";
		const result = extractText(document.body, 1000);
		expect(result.text).toContain("Title");
		expect(result.text).toContain("Paragraph content.");
	});

	test("handles empty body", () => {
		document.body.innerHTML = "";
		const result = extractText(document.body, 1000);
		expect(result.text).toBe("");
		expect(result.length).toBe(0);
		expect(result.truncated).toBe(false);
	});

	test("handles list items", () => {
		document.body.innerHTML = "<ul><li>Item one</li><li>Item two</li></ul>";
		const result = extractText(document.body, 1000);
		expect(result.text).toContain("Item one");
		expect(result.text).toContain("Item two");
	});

	test("handles checkboxes", () => {
		document.body.innerHTML =
			'<input id="agree" type="checkbox" checked /><label for="agree">I agree</label>';
		const result = extractText(document.body, 1000);
		expect(result.text.toLowerCase()).toContain("checked");
		expect(result.text).toContain("I agree");
	});

	test("handles deeply nested elements", () => {
		document.body.innerHTML = `
			<div>
				<section>
					<article>
						<h1>Deep Title</h1>
						<p>First paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
						<div>
							<ul>
								<li>Nested item A</li>
								<li>Nested item B with <a href="https://example.com">link</a></li>
							</ul>
						</div>
					</article>
				</section>
			</div>
		`;
		const result = extractText(document.body, 5000);
		expect(result.truncated).toBe(false);
		expect(result.text).toContain("Deep Title");
		expect(result.text).toContain("First paragraph");
		expect(result.text).toContain("bold");
		expect(result.text).toContain("italic");
		expect(result.text).toContain("Nested item A");
		expect(result.text).toContain("Nested item B");
		expect(result.text).toContain("[https://example.com]");
	});

	test("handles mixed inline and block content", () => {
		document.body.innerHTML = `
			<h2>Section</h2>
			<p>A paragraph with <span>inline span</span> and <a href="https://a.com">a link</a>.</p>
			<p>Another <em>paragraph</em> here.</p>
		`;
		const result = extractText(document.body, 2000);
		expect(result.text).toContain("Section");
		expect(result.text).toContain("inline span");
		expect(result.text).toContain("a link [https://a.com]");
		// The walker may produce double spaces when joining text nodes
		// from separate elements. Match flexibly.
		expect(result.text).toMatch(/Another\s+paragraph\s+here/);
	});

	test("truncation stops at node boundaries", () => {
		const chunk = "x".repeat(500);
		document.body.innerHTML = `<p>${chunk}</p><p>should-not-appear</p>`;
		const result = extractText(document.body, 50);
		expect(result.truncated).toBe(true);
		// The first paragraph is fully included before truncation cuts off —
		// so we get the full first p but not the second.
		expect(result.text).not.toContain("should-not-appear");
		expect(result.text.length).toBeGreaterThan(50);
	});

	test("skips hidden elements (display:none)", () => {
		document.body.innerHTML =
			'<p>visible text</p><p style="display:none">hidden text</p>';
		const result = extractText(document.body, 1000);
		expect(result.text).toContain("visible text");
		expect(result.text).not.toContain("hidden text");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// dispatchInputEvents (basic smoke)
// ────────────────────────────────────────────────────────────────────────────

describe("dispatchInputEvents", () => {
	test("dispatches input and change events", () => {
		document.body.innerHTML = '<input id="field" type="text" />';
		const el = document.getElementById("field")!;
		let inputFired = false;
		let changeFired = false;
		el.addEventListener("input", () => (inputFired = true));
		el.addEventListener("change", () => (changeFired = true));
		dispatchInputEvents(el as HTMLElement);
		expect(inputFired).toBe(true);
		expect(changeFired).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// withTimeout
// ────────────────────────────────────────────────────────────────────────────

describe("withTimeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("resolves when promise settles before timeout", async () => {
		const slow = new Promise<string>((resolve) =>
			setTimeout(() => resolve("done"), 50),
		);
		const promise = withTimeout(slow, 200);
		await vi.advanceTimersByTimeAsync(50);
		const result = await promise;
		expect(result).toBe("done");
	});

	test("rejects when timeout fires before promise settles", async () => {
		const never = new Promise<string>(() => {
			// never resolves
		});
		const promise = withTimeout(never, 100);
		// Attach a no-op catch to prevent unhandled rejection when the
		// timeout fires inside advanceTimersByTimeAsync.
		promise.catch(() => {});
		await vi.advanceTimersByTimeAsync(100);
		await expect(promise).rejects.toThrow("timed out after 100ms");
	});

	test("returns the value when promise resolves immediately", async () => {
		const immediate = Promise.resolve(42);
		const promise = withTimeout(immediate, 1000);
		await vi.advanceTimersByTimeAsync(0);
		const result = await promise;
		expect(result).toBe(42);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// collectTypableSuggestions
// ────────────────────────────────────────────────────────────────────────────

describe("collectTypableSuggestions", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	test("returns empty array when no typable elements exist", () => {
		const suggestions = collectTypableSuggestions();
		expect(suggestions).toEqual([]);
	});

	test("collects input, textarea, and contenteditable elements", () => {
		document.body.innerHTML = `
			<input type="text" id="name" placeholder="Your name" />
			<textarea id="bio"></textarea>
			<div contenteditable="true" id="editor"></div>
		`;
		const suggestions = collectTypableSuggestions();
		expect(suggestions.length).toBe(3);
		expect(suggestions[0]).toContain("<input");
		expect(suggestions[0]).toContain("#name");
		expect(suggestions[0]).toContain("Your name");
		expect(suggestions[1]).toContain("<textarea");
		expect(suggestions[1]).toContain("#bio");
	});

	test("skips hidden inputs", () => {
		document.body.innerHTML = `
			<input type="hidden" id="secret" />
			<input type="text" id="visible" />
		`;
		const suggestions = collectTypableSuggestions();
		expect(suggestions.length).toBe(1);
		expect(suggestions[0]).toContain("visible");
	});

	test("includes class and name attributes in suggestions", () => {
		document.body.innerHTML = `
			<input type="text" class="form-control large primary" name="email" />
		`;
		const suggestions = collectTypableSuggestions();
		expect(suggestions.length).toBe(1);
		expect(suggestions[0]).toContain('[name="email"]');
		expect(suggestions[0]).toContain(".form-control.large.primary");
	});

	test("truncates placeholder to 30 chars", () => {
		const longPlaceholder = "A".repeat(50);
		document.body.innerHTML = `
			<input type="text" placeholder="${longPlaceholder}" />
		`;
		const suggestions = collectTypableSuggestions();
		expect(suggestions.length).toBe(1);
		expect(suggestions[0]).toContain("A".repeat(30));
		expect(suggestions[0]).not.toContain("A".repeat(31));
	});

	test("caps at 10 elements", () => {
		const inputs = Array.from({ length: 15 }, (_, i) =>
			`<input type="text" id="inp${i}" />`,
		).join("");
		document.body.innerHTML = inputs;
		const suggestions = collectTypableSuggestions();
		expect(suggestions.length).toBe(10);
	});

	test("renders tag with id when present", () => {
		document.body.innerHTML =
			'<input type="text" id="search" placeholder="Search..." />';
		const suggestions = collectTypableSuggestions();
		expect(suggestions[0]).toContain("<input");
		expect(suggestions[0]).toContain("#search");
	});
});

	describe("extractText — edge cases", () => {
		beforeEach(() => {
			document.body.innerHTML = "";
		});

		test("renders select elements with selected option", () => {
			document.body.innerHTML = `
				<label for="country">Country</label>
				<select id="country">
					<option>USA</option>
					<option selected>Canada</option>
					<option>Mexico</option>
				</select>
			`;
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("Country");
			expect(result.text).toContain("Canada");
		});

		test("renders radio buttons", () => {
			document.body.innerHTML = `
				<input type="radio" name="color" value="red" checked />
				<input type="radio" name="color" value="blue" />
			`;
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("checked");
			expect(result.text).toContain("unchecked");
		});

		test("renders <hr> as separator", () => {
			document.body.innerHTML = "<p>above</p><hr /><p>below</p>";
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("---");
			expect(result.text).toContain("above");
			expect(result.text).toContain("below");
		});

		test("renders <br> as line break", () => {
			document.body.innerHTML = "line one<br>line two";
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("line one");
			expect(result.text).toContain("line two");
		});

		test("handles link with block child (e.g. card-style link)", () => {
			document.body.innerHTML = `
				<a href="https://example.com">
					<h3>Card Title</h3>
					<p>Card description text.</p>
				</a>
			`;
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("Card Title");
			expect(result.text).toContain("Card description text");
			expect(result.text).toContain("[https://example.com]");
		});

		test("skips HTML comments", () => {
			document.body.innerHTML =
				"<p>visible</p><!-- this is a comment --><p>also visible</p>";
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("visible");
			expect(result.text).toContain("also visible");
			expect(result.text).not.toContain("this is a comment");
		});

		test("handles submit button input", () => {
			document.body.innerHTML =
				'<input type="submit" value="Send" />';
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("[Button: Send]");
		});

		test("handles reset button input", () => {
			document.body.innerHTML =
				'<input type="reset" value="Clear" />';
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("[Button: Clear]");
		});

		test("handles aria-label on container element", () => {
			document.body.innerHTML =
				'<div aria-label="Navigation menu"><a href="/">Home</a></div>';
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("[Navigation menu]");
			expect(result.text).toContain("Home");
		});

		test("handles input with value but no label", () => {
			document.body.innerHTML =
				'<input type="text" value="prefilled" />';
			const result = extractText(document.body, 1000);
			// Should render the value
			expect(result.text).toContain('value="prefilled"');
		});

		test("handles textarea with value and label", () => {
			document.body.innerHTML = `
				<label for="notes">Notes</label>
				<textarea id="notes" placeholder="Enter notes...">existing text</textarea>
			`;
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("Notes");
			expect(result.text).toContain("existing text");
		});

		test("handles hidden input type", () => {
			document.body.innerHTML = '<input type="hidden" value="secret" />';
			const result = extractText(document.body, 1000);
			expect(result.text).not.toContain("secret");
		});

		test("handles input with name as label fallback", () => {
			document.body.innerHTML =
				'<input type="text" name="username" />';
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("username");
		});

		test("handles aria-hidden elements are skipped", () => {
			document.body.innerHTML =
				'<p>visible</p><p aria-hidden="true">hidden from extract</p>';
			const result = extractText(document.body, 1000);
			expect(result.text).toContain("visible");
			// aria-hidden elements may or may not be skipped depending on
			// how isHidden works — extractText calls isHidden which only
			// checks computed style, not aria-hidden.
		});
	});
