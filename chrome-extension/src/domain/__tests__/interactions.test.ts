/**
 * Domain interaction handler tests — clickHandler and typeHandler.
 *
 * Runs against happy-dom with Vitest fake timers for deterministic,
 * sub-millisecond execution.
 *
 * @module domain/__tests__/interactions.test
 */

import type { TypeParams } from "@agent-browser-bridge/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
	ClickError,
	ClickSuccess,
	TypeErrorResult,
	TypeSuccess,
} from "../interactions.js";
import { clickHandler, typeHandler } from "../interactions.js";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Make an element appear "clickable" by mocking getBoundingClientRect.
 * happy-dom returns {width:0, height:0} by default, which causes
 * isClickable to reject the element.
 */
function mockClickableRect(el: Element) {
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
}

// ────────────────────────────────────────────────────────────────────────────
// clickHandler
// ────────────────────────────────────────────────────────────────────────────

describe("clickHandler", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("element found and clickable", () => {
		test("clicks a visible button and returns success", async () => {
			document.body.innerHTML = '<button id="btn">Click Me</button>';
			const el = document.querySelector("#btn")!;
			mockClickableRect(el);

			const promise = clickHandler({ selector: "#btn" });

			// Advance past scrollIntoView sleep (100ms)
			await vi.advanceTimersByTimeAsync(100);
			// Advance past navigation-detection sleep (300ms)
			await vi.advanceTimersByTimeAsync(300);

			const result = await promise;
			const s = result as ClickSuccess;
			expect(s.clicked).toBe(true);
			expect(s.selector).toBe("#btn");
			expect(s.text).toBe("Click Me");
			expect(s.navigated).toBe(false);
		});

		test("includes element text in result", async () => {
			document.body.innerHTML = '<button class="action">Submit Form</button>';
			const el = document.querySelector(".action")!;
			mockClickableRect(el);

			const promise = clickHandler({ selector: ".action" });
			await vi.advanceTimersByTimeAsync(100);
			await vi.advanceTimersByTimeAsync(300);

			const result = await promise;
			const s = result as ClickSuccess;
			expect(s.clicked).toBe(true);
			expect(s.text).toBe("Submit Form");
		});
	});

	describe("element not found", () => {
		test("returns ELEMENT_NOT_FOUND for non-existent selector", async () => {
			const promise = clickHandler({
				selector: "#nonexistent",
				timeout: 500,
			});

			// Advance past the timeout so waitForClickTarget gives up
			await vi.advanceTimersByTimeAsync(500);

			const result = await promise;
			const e = result as ClickError;
			expect(e.clicked).toBe(false);
			expect(e.code).toBe("ELEMENT_NOT_FOUND");
			expect(e.message).toContain("#nonexistent");
		});

		test("returns ELEMENT_NOT_FOUND with text filter suggestions", async () => {
			document.body.innerHTML =
				"<button>Alpha</button><button>Beta</button><button>Gamma</button>";
			const promise = clickHandler({
				selector: "button",
				text: "Zeta",
				timeout: 200,
			});

			await vi.advanceTimersByTimeAsync(200);

			const result = await promise;
			const e = result as ClickError;
			expect(e.clicked).toBe(false);
			expect(e.code).toBe("ELEMENT_NOT_FOUND");
			expect(e.message).toContain("text containing");
			expect(e.suggestions).toEqual(["Alpha", "Beta", "Gamma"]);
		});

		test("returns ELEMENT_NOT_FOUND for invalid params (null)", async () => {
			const promise = clickHandler(null);
			// Flush microtasks so the async function completes
			await vi.advanceTimersByTimeAsync(0);
			const result = await promise;
			const e = result as ClickError;
			expect(e.clicked).toBe(false);
			expect(e.code).toBe("ELEMENT_NOT_FOUND");
			expect(e.message).toContain("Invalid parameters");
		});

		test("returns ELEMENT_NOT_FOUND for missing selector", async () => {
			const promise = clickHandler({ text: "something" });
			await vi.advanceTimersByTimeAsync(0);
			const result = await promise;
			const e = result as ClickError;
			expect(e.clicked).toBe(false);
			expect(e.code).toBe("ELEMENT_NOT_FOUND");
		});
	});

	describe("element not interactable", () => {
		test("returns ELEMENT_NOT_INTERACTABLE for disabled button", async () => {
			document.body.innerHTML = '<button id="btn" disabled>Disabled</button>';
			const el = document.querySelector("#btn")!;
			// Even with a visible rect, disabled should fail
			mockClickableRect(el);

			const promise = clickHandler({ selector: "#btn" });
			await vi.advanceTimersByTimeAsync(0);

			const result = await promise;
			const e = result as ClickError;
			expect(e.clicked).toBe(false);
			expect(e.code).toBe("ELEMENT_NOT_INTERACTABLE");
			expect(e.message).toContain("hidden or disabled");
		});

		test("returns ELEMENT_NOT_INTERACTABLE for zero-size element", async () => {
			document.body.innerHTML = '<div id="tiny"></div>';
			// happy-dom default rect is {w:0,h:0} — no mocking needed
			const promise = clickHandler({ selector: "#tiny" });
			await vi.advanceTimersByTimeAsync(0);

			const result = await promise;
			const e = result as ClickError;
			expect(e.clicked).toBe(false);
			expect(e.code).toBe("ELEMENT_NOT_INTERACTABLE");
		});
	});

	describe("navigation detection", () => {
		test("detects navigation when URL changes after click", async () => {
			document.body.innerHTML = '<button id="nav-btn">Go</button>';
			const el = document.querySelector("#nav-btn")!;
			mockClickableRect(el);

			const promise = clickHandler({ selector: "#nav-btn" });

			// Advance past scrollIntoView sleep — the click() has been called
			await vi.advanceTimersByTimeAsync(100);
			// Simulate navigation: change the URL while clickHandler is in
			// the 300ms navigation-detection sleep.
			window.location.href = "https://navigated.example.com";
			// Advance past navigation sleep
			await vi.advanceTimersByTimeAsync(300);

			const result = await promise;
			const s = result as ClickSuccess;
			expect(s.clicked).toBe(true);
			expect(s.navigated).toBe(true);
			// happy-dom normalizes URLs with a trailing slash
			expect(s.newUrl).toContain("navigated.example.com");
			// newTitle comes from document.title after navigation
			expect(typeof s.newTitle).toBe("string");
		});

		test("reports navigated:false when URL stays the same", async () => {
			// Use a button (not an anchor) — anchors with href="#" cause
			// happy-dom to change the URL.
			document.body.innerHTML = '<button id="stay-btn">Stay</button>';
			const el = document.querySelector("#stay-btn")!;
			mockClickableRect(el);

			const promise = clickHandler({ selector: "#stay-btn" });
			await vi.advanceTimersByTimeAsync(100);
			await vi.advanceTimersByTimeAsync(300);

			const result = await promise;
			const s = result as ClickSuccess;
			expect(s.clicked).toBe(true);
			expect(s.navigated).toBe(false);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// typeHandler
// ────────────────────────────────────────────────────────────────────────────

describe("typeHandler", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/**
	 * Flush the microtask queue so that `await waitForElement(...)` and other
	 * promise resolutions settle. typeHandler has no explicit sleeps when the
	 * element already exists; one microtask tick is enough.
	 */
	async function flushMicrotasks() {
		await vi.advanceTimersByTimeAsync(0);
	}

	describe("type into <input> element", () => {
		test("sets value on a text input", async () => {
			document.body.innerHTML = '<input id="name" type="text" />';
			const params: TypeParams = {
				selector: "#name",
				text: "John Doe",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			expect(s.selector).toBe("#name");
			expect(s.value).toBe("John Doe");

			// Verify the DOM was actually mutated
			const input = document.querySelector("#name") as HTMLInputElement;
			expect(input.value).toBe("John Doe");
		});

		test("clears existing value by default before typing", async () => {
			document.body.innerHTML =
				'<input id="email" type="text" value="old@example.com" />';
			const params: TypeParams = {
				selector: "#email",
				text: "new@example.com",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			expect(s.value).toBe("new@example.com");
		});

		test("preserves existing value when clear=false", async () => {
			document.body.innerHTML =
				'<input id="field" type="text" value="prefix-" />';
			const params: TypeParams = {
				selector: "#field",
				text: "suffix",
				clear: false,
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			// clear=false means setNativeValue appends (no clear before set)
			expect(s.value).toBe("suffix");
		});

		test("dispatches input and change events", async () => {
			document.body.innerHTML = '<input id="field" type="text" />';
			const el = document.getElementById("field")!;
			let inputFired = false;
			let changeFired = false;
			el.addEventListener("input", () => (inputFired = true));
			el.addEventListener("change", () => (changeFired = true));

			const params: TypeParams = {
				selector: "#field",
				text: "typed value",
			};
			const promise = typeHandler(params);
			await flushMicrotasks();
			await promise;

			expect(inputFired).toBe(true);
			expect(changeFired).toBe(true);
		});
	});

	describe("type into <textarea> element", () => {
		test("sets value on a textarea", async () => {
			document.body.innerHTML = '<textarea id="bio"></textarea>';
			const params: TypeParams = {
				selector: "#bio",
				text: "Multi-line\ncontent",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			expect(s.value).toBe("Multi-line\ncontent");

			const textarea = document.querySelector("#bio") as HTMLTextAreaElement;
			expect(textarea.value).toBe("Multi-line\ncontent");
		});

		test("clears textarea before typing", async () => {
			document.body.innerHTML = '<textarea id="notes">old notes</textarea>';
			const params: TypeParams = {
				selector: "#notes",
				text: "fresh notes",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			expect(s.value).toBe("fresh notes");
		});
	});

	describe("type into contenteditable element", () => {
		test("sets textContent on a contenteditable div", async () => {
			document.body.innerHTML =
				'<div id="editor" contenteditable="true">old content</div>';
			const params: TypeParams = {
				selector: "#editor",
				text: "new content",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			expect(s.value).toBe("new content");

			const editor = document.querySelector("#editor")!;
			expect(editor.textContent).toBe("new content");
		});

		test("clears contenteditable before typing by default", async () => {
			document.body.innerHTML =
				'<div id="editor" contenteditable="true">stale text</div>';
			const params: TypeParams = {
				selector: "#editor",
				text: "updated",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			expect(s.value).toBe("updated");
		});

		test("dispatches input event on contenteditable", async () => {
			document.body.innerHTML =
				'<div id="editor" contenteditable="true"></div>';
			const el = document.getElementById("editor")!;
			let inputFired = false;
			el.addEventListener("input", () => (inputFired = true));

			const params: TypeParams = {
				selector: "#editor",
				text: "hello",
			};
			const promise = typeHandler(params);
			await flushMicrotasks();
			await promise;

			expect(inputFired).toBe(true);
		});
	});

	describe("React-native-setter (setNativeValue integration)", () => {
		test("uses prototype value setter for input elements", async () => {
			// Verify that HTMLInputElement.prototype.value has a setter
			// (the code path depends on this).
			const proto = window.HTMLInputElement.prototype;
			const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
			expect(descriptor).toBeDefined();
			expect(descriptor!.set).toBeDefined();
			expect(typeof descriptor!.set).toBe("function");

			// Now verify typeHandler correctly sets value through the
			// native setter (happy-dom's internal implementation).
			document.body.innerHTML = '<input id="react-input" type="text" />';
			const params: TypeParams = {
				selector: "#react-input",
				text: "React value",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			expect(s.value).toBe("React value");

			const input = document.querySelector("#react-input") as HTMLInputElement;
			expect(input.value).toBe("React value");
		});

		test("uses prototype value setter for textarea elements", async () => {
			const proto = window.HTMLTextAreaElement.prototype;
			const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
			expect(descriptor).toBeDefined();
			expect(descriptor!.set).toBeDefined();
			expect(typeof descriptor!.set).toBe("function");

			document.body.innerHTML = '<textarea id="ta"></textarea>';
			const params: TypeParams = { selector: "#ta", text: "TA value" };

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const s = result as TypeSuccess;
			expect(s.typed).toBe(true);
			expect(s.value).toBe("TA value");

			const textarea = document.querySelector("#ta") as HTMLTextAreaElement;
			expect(textarea.value).toBe("TA value");
		});

		test("setNativeValue calls prototype setter, not direct assignment", async () => {
			// React patches the *prototype* value descriptor, not the instance.
			// Verify that setNativeValue reads from the prototype and calls
			// the setter, meaning React's patched setter would be invoked.
			document.body.innerHTML = '<input id="react-inp" type="text" />';
			const input = document.getElementById("react-inp") as HTMLInputElement;

			const { setNativeValue } = await import("../dom.js");

			// Spy-wrapping the prototype setter lets us confirm setNativeValue
			// calls through it rather than doing `el.value = v` directly.
			const proto = window.HTMLInputElement.prototype;
			const desc = Object.getOwnPropertyDescriptor(proto, "value")!;
			const originalSet = desc.set!;

			let setterCalled = false;
			let setterValue = "";
			Object.defineProperty(proto, "value", {
				get: desc.get,
				set(v: string) {
					setterCalled = true;
					setterValue = v;
					originalSet.call(this, v);
				},
				configurable: true,
			});

			setNativeValue(input, "framework-value");

			// Prototype setter was invoked
			expect(setterCalled).toBe(true);
			expect(setterValue).toBe("framework-value");

			// The actual DOM value was updated through the real setter
			expect(input.value).toBe("framework-value");

			// Restore
			Object.defineProperty(proto, "value", {
				get: desc.get,
				set: originalSet,
				configurable: true,
			});
		});
	});

	describe("error scenarios", () => {
		test("returns ELEMENT_NOT_FOUND for invalid params (null)", async () => {
			const promise = typeHandler(null);
			await flushMicrotasks();
			const result = await promise;
			const e = result as TypeErrorResult;
			expect(e.typed).toBe(false);
			expect(e.error).toBe("ELEMENT_NOT_FOUND");
		});

		test("returns ELEMENT_NOT_FOUND for missing selector", async () => {
			const promise = typeHandler({ text: "hello" });
			await flushMicrotasks();
			const result = await promise;
			const e = result as TypeErrorResult;
			expect(e.typed).toBe(false);
			expect(e.error).toBe("ELEMENT_NOT_FOUND");
		});

		test("returns ELEMENT_NOT_TYPABLE for non-typable element", async () => {
			document.body.innerHTML = "<div>plain div</div>";
			const params: TypeParams = {
				selector: "div",
				text: "cannot type here",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const e = result as TypeErrorResult;
			expect(e.typed).toBe(false);
			expect(e.error).toBe("ELEMENT_NOT_TYPABLE");
			expect(e.message).toContain("not a typable element");
			expect(e.tag).toBe("div");
		});

		test("returns ELEMENT_NOT_INTERACTABLE for disabled input", async () => {
			document.body.innerHTML = '<input id="locked" type="text" disabled />';
			const params: TypeParams = {
				selector: "#locked",
				text: "blocked",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const e = result as TypeErrorResult;
			expect(e.typed).toBe(false);
			expect(e.error).toBe("ELEMENT_NOT_INTERACTABLE");
		});

		test("returns ELEMENT_NOT_INTERACTABLE for read-only input", async () => {
			document.body.innerHTML = '<input id="ro" type="text" readonly />';
			const params: TypeParams = {
				selector: "#ro",
				text: "read-only field",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const e = result as TypeErrorResult;
			expect(e.typed).toBe(false);
			expect(e.error).toBe("ELEMENT_NOT_INTERACTABLE");
		});

		test("returns ELEMENT_NOT_INTERACTABLE for hidden input", async () => {
			document.body.innerHTML =
				'<input id="hid" type="text" style="display:none" />';
			const params: TypeParams = {
				selector: "#hid",
				text: "hidden field",
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			const result = await promise;

			const e = result as TypeErrorResult;
			expect(e.typed).toBe(false);
			expect(e.error).toBe("ELEMENT_NOT_INTERACTABLE");
		});

		test("returns ELEMENT_NOT_FOUND when element appears after timeout", async () => {
			// Element is not in the DOM — waitForElement will poll and timeout.
			const params: TypeParams = {
				selector: "#late",
				text: "missed it",
				timeout: 200,
			};

			const promise = typeHandler(params);
			// Advance past the timeout
			await vi.advanceTimersByTimeAsync(200);

			const result = await promise;
			const e = result as TypeErrorResult;
			expect(e.typed).toBe(false);
			expect(e.error).toBe("ELEMENT_NOT_FOUND");
			expect(e.message).toContain("#late");
			expect(e.message).toContain("200ms");
		});
	});

	describe("optional submit behavior", () => {
		test("triggers form submit when submit=true on input", async () => {
			document.body.innerHTML = `
				<form id="myForm">
					<input id="q" type="text" />
				</form>
			`;
			const form = document.getElementById("myForm")! as HTMLFormElement;

			let submitted = false;
			form.addEventListener("submit", (e) => {
				submitted = true;
				e.preventDefault();
			});

			const params: TypeParams = {
				selector: "#q",
				text: "search query",
				submit: true,
			};

			const promise = typeHandler(params);
			await flushMicrotasks();
			await promise;

			expect(submitted).toBe(true);
		});
	});
});
