import { requestPresentation } from "./chatPresentation";
import { pendingApproval, pendingInput, type ConversationSnapshot, type DecisionOption } from "./types";

/**
 * What the docked bar above the composer should show, if anything.
 *
 * Approval and input cards render inline in the timeline, which is right for
 * their full form — an elicitation can be a multi-question wizard with its own
 * validation. But it means the one thing blocking the agent scrolls away as soon
 * as you read back, or as soon as the agent emits more output. The dock is a
 * shortcut to it, not a replacement for it.
 *
 * Pure, so which request wins and what it says is unit-tested rather than
 * decided inside the screen.
 */
export type ApprovalDockModel = {
	kind: "approval" | "input";
	/** "Approval needed" / "Agent needs input" — from the same source as the card. */
	title: string;
	/** The command, question, or whatever the request is actually about. */
	summary: string;
	/** Present for approvals that offered decisions; empty for an input request. */
	decisions: DecisionOption[];
	/** Handle for resolving. Absent means the dock can only jump, not act. */
	requestId?: string;
	/** Where the full card lives, for the jump affordance. */
	sequence: number;
	/** A resolve is already in flight, so the buttons disable. */
	busy: boolean;
};

/**
 * Approval outranks input when both are somehow pending: an approval is usually
 * a command waiting to run, and it is the cheaper of the two to answer.
 */
export function approvalDockModel(
	snapshot: ConversationSnapshot | undefined,
	pending: { approval: boolean; input: boolean },
): ApprovalDockModel | null {
	if (!snapshot) return null;

	const approval = pendingApproval(snapshot);
	if (approval) {
		return {
			kind: "approval",
			title: requestPresentation("approval", true).title,
			// Same fallback the card uses, so the two never disagree about what the
			// request is.
			summary: approval.detail?.command ?? approval.summary ?? "",
			decisions: approval.decisions ?? [],
			requestId: approval.requestId,
			sequence: approval.sequence,
			busy: pending.approval,
		};
	}

	const input = pendingInput(snapshot);
	if (input) {
		return {
			kind: "input",
			title: requestPresentation("input", true).title,
			// An elicitation's question can be a whole schema; the dock shows the
			// prompt and sends you to the card to answer it.
			summary: input.detail?.message || input.detail?.schema?.description || input.summary || "",
			// Deliberately empty: an input request is answered in its card, which
			// owns the fields, the validation and the multi-question paging. A pair
			// of dock buttons could only ever answer the trivial case.
			decisions: [],
			requestId: input.requestId,
			sequence: input.sequence,
			busy: pending.input,
		};
	}

	return null;
}

/** Whether the dock can resolve in place, or only jump to the card. */
export function dockCanResolve(model: ApprovalDockModel): boolean {
	return model.kind === "approval" && Boolean(model.requestId) && model.decisions.length > 0;
}
