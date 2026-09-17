import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const card = readFileSync(new URL("./project-card.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/project/[id].tsx", import.meta.url), "utf8");
const projects = readFileSync(new URL("../app/(tabs)/projects.tsx", import.meta.url), "utf8");

describe("project card hierarchy", () => {
	// The orchestrator is the reason to be on this page; counts used to be chips
	// that outshouted it.
	it("leads with a full-width orchestrator button drawn with the desktop mark", () => {
		expect(card).toContain("<OrchestratorButton");
		expect(card).toContain("<OrchestratorIcon");
		expect(card).toMatch(/button:\s*\{[^}]*minHeight:\s*44[^}]*backgroundColor:\s*t\.textPrimary/s);
	});

	it("keeps counts as quiet text rather than chips", () => {
		expect(card).toContain("projectCardSummary(row)");
		expect(card).not.toContain("<Chip");
	});

	it("keeps the status rail and still refuses a generic folder glyph", () => {
		expect(card).toContain("railColor(t, projectRailTone(row))");
		expect(card).not.toContain('<Feather name="folder"');
	});

	it("opens the project from the card and the orchestrator from the button", () => {
		expect(card).toContain("onPress={() => onOpenProject(row)}");
		expect(projects).toContain('pathname: "/project/[id]"');
		expect(projects).toContain("onOrchestrator={openOrchestrator}");
	});
});

describe("project page", () => {
	it("puts the orchestrator on top of the project's workers", () => {
		expect(page).toContain("ListHeaderComponent={");
		expect(page).toContain("<ProjectOrchestratorPanel");
	});

	// Reuses the board rather than copying it, so the two cannot drift.
	it("lists workers with the Workers board, archive included", () => {
		expect(page).toContain("<WorkerBoardList");
		expect(page).toContain("projectDetailSessions(");
	});
});
