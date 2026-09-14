import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./orchestrator-project-row.tsx", import.meta.url), "utf8");

describe("project row identity", () => {
	// The mark used to lead every row. It is identical on all of them, so it could
	// not tell two rows apart while occupying the one position that carries state.
	// A status rail took the slot.
	it("leads with a status rail rather than a per-row mark", () => {
		expect(source).toContain("styles.rail");
		expect(source).toContain("railColor(t, projectRailTone(row))");
		expect(source).not.toContain('import MASCOT from "../assets/mascot.png"');
		expect(source).not.toContain("source={MASCOT}");
	});

	// Kept from the original test: a generic folder glyph was rejected as the
	// project's identity, and that decision still stands.
	it("still refuses a generic folder glyph", () => {
		expect(source).not.toContain('<Feather name="folder"');
	});

	it("says which worker is blocked, not just that something is", () => {
		expect(source).toContain("projectBlockerLine(row)");
		expect(source).toContain("styles.blockerWorker");
	});

	// The section header already says "Needs Attention"; the row used to repeat it
	// as a headline and then again in the status label.
	it("does not restate the section header inside the row", () => {
		expect(source).not.toContain("row.headline");
		expect(source).not.toContain("showProjectDetail");
	});

	it("promotes counts to chips", () => {
		expect(source).toContain("projectRowChips(row)");
		expect(source).toContain("<Chip");
	});
});

describe("project row density", () => {
	// One grid in every state. The old row switched between minHeight 56 with full
	// width and minHeight 92 with paddingRight 118, so text wrapped at two
	// different measures depending on whether the orchestrator was running.
	it("uses one row shape regardless of state", () => {
		expect(source).toMatch(/body:\s*\{[^}]*minHeight:\s*72/s);
		expect(source).not.toMatch(/runningContent|actionContent/);
	});

	// OrchestratorRowAction is a fixed 88x44 @expo/ui Host; a narrower column
	// clips it silently on iOS rather than erroring.
	it("reserves a trailing column wide enough for the launch action", () => {
		expect(source).toMatch(/trailing:\s*\{[^}]*width:\s*88/s);
	});

	it("gives nested worker rows a real touch target and a drawn connector", () => {
		expect(source).toMatch(/workerRow:\s*\{[^}]*minHeight:\s*44/s);
		expect(source).toContain("workerRail");
	});

	it("keeps the project name as the heaviest thing on the row", () => {
		expect(source).toMatch(/project:\s*\{[^}]*fontSize:\s*17[^}]*fontWeight:\s*"700"/s);
	});
});
