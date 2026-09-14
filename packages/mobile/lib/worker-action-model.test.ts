import { describe, expect, it } from "vitest";

import {
	hasWorkerActionDrawable,
	workerActionSymbol,
	workerContextActions,
	type WorkerActionState,
} from "./worker-action-model";

const state = (over: Partial<WorkerActionState> = {}): WorkerActionState => ({
	pinned: false,
	terminated: false,
	stopped: false,
	hasPr: false,
	...over,
});

const ids = (over: Partial<WorkerActionState> = {}) => workerContextActions(state(over)).map((a) => a.id);

describe("workerContextActions", () => {
	it("offers the always-available actions on a plain running worker", () => {
		expect(ids()).toEqual(["open", "pin", "rename", "delete"]);
	});

	it("flips pin to unpin for a pinned worker", () => {
		expect(ids({ pinned: true })).toContain("unpin");
		expect(ids({ pinned: true })).not.toContain("pin");
	});

	it("offers the pull request only when there is one", () => {
		expect(ids({ hasPr: true })).toContain("openPr");
		expect(ids()).not.toContain("openPr");
	});

	// The chat screen already makes this choice: a terminated AO session is
	// restored, a merely stopped agent is resumed. Offering both would push that
	// distinction onto the user.
	it("offers resume for a stopped agent and restore for a terminated session", () => {
		expect(ids({ stopped: true })).toContain("resume");
		expect(ids({ stopped: true })).not.toContain("restore");
		expect(ids({ terminated: true })).toContain("restore");
		expect(ids({ terminated: true })).not.toContain("resume");
	});

	it("prefers restore when a session is both terminated and stopped", () => {
		expect(ids({ terminated: true, stopped: true })).toContain("restore");
		expect(ids({ terminated: true, stopped: true })).not.toContain("resume");
	});

	// Regression fence: there is no stop or pause endpoint. kill() is what Delete
	// calls, so a "stop" entry would be a second name for the same destructive
	// action.
	it("never offers an action without an endpoint behind it", () => {
		const everything = [
			...ids(),
			...ids({ pinned: true, hasPr: true, stopped: true }),
			...ids({ terminated: true, hasPr: true }),
		];
		expect(everything).not.toContain("stop");
		expect(everything).not.toContain("pause");
	});

	it("keeps the destructive action last and marked", () => {
		for (const over of [{}, { pinned: true, hasPr: true }, { terminated: true }]) {
			const actions = workerContextActions(state(over));
			const last = actions.at(-1);
			expect(last?.id).toBe("delete");
			expect(last?.destructive).toBe(true);
			expect(actions.filter((a) => a.destructive)).toHaveLength(1);
		}
	});

	it("opens with Open, so the menu's first item is the row's own tap", () => {
		expect(ids({ terminated: true, hasPr: true, pinned: true })[0]).toBe("open");
	});
});

describe("workerActionSymbol", () => {
	it("gives every action an SF Symbol, since iOS resolves them by name", () => {
		for (const action of workerContextActions(state({ hasPr: true, stopped: true }))) {
			expect(workerActionSymbol(action.id).length).toBeGreaterThan(0);
		}
	});

	it("distinguishes pin from unpin", () => {
		expect(workerActionSymbol("pin")).not.toBe(workerActionSymbol("unpin"));
	});
});

describe("hasWorkerActionDrawable", () => {
	// Android and the fallback menu require() a bundled drawable, and a missing
	// file is a bundle-time failure rather than a blank icon — so this list has to
	// track assets/icons exactly. Every action now ships one, so the Android menu
	// reads like the iOS one rather than a half-iconned list.
	it("claims an icon for every action", () => {
		for (const id of ["pin", "unpin", "rename", "delete", "open", "openPr", "resume", "restore"] as const) {
			expect(hasWorkerActionDrawable(id)).toBe(true);
		}
	});
});
