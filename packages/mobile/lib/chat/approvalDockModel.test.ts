import { describe, expect, it } from "vitest";

import { approvalDockModel, dockCanResolve } from "./approvalDockModel";
import type { ConversationActivity, ConversationSnapshot } from "./types";

const activity = (over: Partial<ConversationActivity> = {}): ConversationActivity =>
	({
		kind: "activity",
		activityKind: "approval",
		status: "pending",
		sequence: 7,
		requestId: "req-1",
		...over,
	}) as ConversationActivity;

const snapshot = (items: ConversationActivity[]): ConversationSnapshot =>
	({ items, turns: [] }) as unknown as ConversationSnapshot;

const idle = { approval: false, input: false };

describe("approvalDockModel", () => {
	it("shows nothing when nothing is pending", () => {
		expect(approvalDockModel(snapshot([]), idle)).toBeNull();
		expect(approvalDockModel(undefined, idle)).toBeNull();
	});

	it("ignores a request that has already been resolved", () => {
		expect(approvalDockModel(snapshot([activity({ status: "resolved" })]), idle)).toBeNull();
	});

	// The card and the dock must never describe the same request differently.
	it("takes an approval's summary from the command, like the card does", () => {
		const model = approvalDockModel(
			snapshot([activity({ detail: { command: "npm test" } as ConversationActivity["detail"] })]),
			idle,
		);
		expect(model?.kind).toBe("approval");
		expect(model?.title).toBe("Approval needed");
		expect(model?.summary).toBe("npm test");
	});

	it("falls back to the activity summary when there is no command", () => {
		const model = approvalDockModel(snapshot([activity({ summary: "Write src/index.ts" })]), idle);
		expect(model?.summary).toBe("Write src/index.ts");
	});

	it("carries the decisions and the request handle so it can resolve in place", () => {
		const model = approvalDockModel(
			snapshot([activity({ decisions: [{ id: "allow", label: "Allow" }, { id: "deny", label: "Deny" }] })]),
			idle,
		);
		expect(model?.decisions.map((d) => d.id)).toEqual(["allow", "deny"]);
		expect(model?.requestId).toBe("req-1");
		expect(dockCanResolve(model!)).toBe(true);
	});

	it("reports the sequence so the dock can jump to the full card", () => {
		expect(approvalDockModel(snapshot([activity({ sequence: 42 })]), idle)?.sequence).toBe(42);
	});

	describe("input requests", () => {
		const input = (over: Partial<ConversationActivity> = {}) =>
			activity({ activityKind: "user_input", ...over });

		it("uses the request's own message as the summary", () => {
			const model = approvalDockModel(
				snapshot([input({ detail: { message: "Which branch?" } as ConversationActivity["detail"] })]),
				idle,
			);
			expect(model?.kind).toBe("input");
			expect(model?.title).toBe("Agent needs input");
			expect(model?.summary).toBe("Which branch?");
		});

		// An elicitation can be a multi-question wizard with validation and URL
		// modes. Two dock buttons could only ever answer the trivial case, so the
		// dock sends you to the card that owns the form.
		it("never offers inline decisions for an input request", () => {
			const model = approvalDockModel(snapshot([input({ decisions: [{ id: "x", label: "X" }] })]), idle);
			expect(model?.decisions).toEqual([]);
			expect(dockCanResolve(model!)).toBe(false);
		});
	});

	it("prefers a pending approval over a pending input", () => {
		const model = approvalDockModel(
			snapshot([activity({ activityKind: "user_input", sequence: 1 }), activity({ sequence: 2 })]),
			idle,
		);
		expect(model?.kind).toBe("approval");
		expect(model?.sequence).toBe(2);
	});

	it("passes the matching in-flight flag through as busy", () => {
		expect(approvalDockModel(snapshot([activity()]), { approval: true, input: false })?.busy).toBe(true);
		expect(approvalDockModel(snapshot([activity({ activityKind: "user_input" })]), { approval: true, input: false })?.busy).toBe(false);
	});
});

describe("dockCanResolve", () => {
	it("refuses when the agent offered no decisions AO can present", () => {
		const model = approvalDockModel(snapshot([activity({ decisions: [] })]), idle);
		expect(dockCanResolve(model!)).toBe(false);
	});

	it("refuses without a request handle", () => {
		const model = approvalDockModel(
			snapshot([activity({ requestId: undefined, decisions: [{ id: "a", label: "Allow" }] })]),
			idle,
		);
		expect(dockCanResolve(model!)).toBe(false);
	});
});
