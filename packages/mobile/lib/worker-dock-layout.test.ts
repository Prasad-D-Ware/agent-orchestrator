import { describe, expect, it } from "vitest";
import { keyboardOverlap, workerDockKeyboardLayout, workerDockVisibility } from "./worker-dock-layout";

describe("worker dock keyboard layout", () => {
	it("anchors the controls directly above the keyboard", () => {
		expect(workerDockKeyboardLayout(336, 34)).toEqual({
			rootPaddingBottom: 0,
			dockBottom: 344,
		});
	});

	it("rests above the home indicator when the keyboard is hidden", () => {
		expect(workerDockKeyboardLayout(0, 34)).toEqual({
			rootPaddingBottom: 0,
			dockBottom: 46,
		});
	});
});

describe("keyboardOverlap", () => {
	it("derives visible keyboard overlap from its screen frame", () => {
		expect(keyboardOverlap(844, 508, 336)).toBe(336);
	});

	it("returns zero once the keyboard frame is below the window", () => {
		expect(keyboardOverlap(844, 844, 336)).toBe(0);
	});
});

describe("worker dock visibility", () => {
	it("replaces both dock actions with search while search is active", () => {
		expect(workerDockVisibility(true)).toEqual({
			showControls: false,
			showSearch: true,
			showSpawn: false,
		});
	});

	it("restores the two dock actions after search closes", () => {
		expect(workerDockVisibility(false)).toEqual({
			showControls: true,
			showSearch: false,
			showSpawn: true,
		});
	});
});
