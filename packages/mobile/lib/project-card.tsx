import Feather from "@expo/vector-icons/Feather";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { relativeTime } from "./notificationView";
import { OrchestratorIcon } from "./orchestrator-icon";
import {
	orchestratorButtonCopy,
	orchestratorStatus,
	projectBlockerLine,
	projectCardSummary,
	projectRailTone,
	type OrchestratorProjectRow,
	type ProjectRailTone,
} from "./orchestratorView";
import type { Theme } from "./theme";
import { useTheme, useThemedStyles } from "./ThemeProvider";
import { fontScaleCap } from "./tokens";
import { Dot } from "./ui";

function railColor(t: Theme, tone: ProjectRailTone): string {
	if (tone === "attention") return t.amber;
	if (tone === "review") return t.red;
	if (tone === "working") return t.orange;
	if (tone === "idle") return t.green;
	return t.textFaint;
}

/**
 * One project on the Projects page: who it is, how its fleet is doing, and the
 * way into its orchestrator.
 *
 * Two targets, never nested. The card opens the project page; the button opens —
 * or starts, or resumes — the orchestrator. The button is the heaviest thing on
 * the card because it is the reason to be on this page; the counts are a quiet
 * line of text, not chips, so they cannot outrank it.
 */
export function ProjectCard({
	row,
	busy,
	onOpenProject,
	onOrchestrator,
}: {
	row: OrchestratorProjectRow;
	busy: boolean;
	onOpenProject: (row: OrchestratorProjectRow) => void;
	onOrchestrator: (row: OrchestratorProjectRow) => void;
}) {
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);
	const status = orchestratorStatus(t, row.link);
	const summary = projectCardSummary(row);
	const blocker = projectBlockerLine(row);
	const timestamp = row.activityAt ? relativeTime(row.activityAt) : "";

	return (
		<View style={styles.card}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${row.project.name}, ${status.label}, ${summary.workers}${summary.needsYou ? `, ${summary.needsYou} need you` : ""}`}
				accessibilityHint="Opens the project"
				onPress={() => onOpenProject(row)}
				style={({ pressed }) => [styles.body, pressed && styles.pressed]}
			>
				{/* The rail carries state without spending a word on it. */}
				<View style={[styles.rail, { backgroundColor: railColor(t, projectRailTone(row)) }]} />
				<View style={styles.main}>
					<View style={styles.titleRow}>
						<Text style={styles.project} numberOfLines={1}>
							{row.project.name}
						</Text>
						{timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
						<Feather name="chevron-right" size={16} color={t.textFaint} />
					</View>

					<View style={styles.summaryRow}>
						<Dot color={status.color} size={6} breathing={status.breathing} />
						<Text style={[styles.summaryStrong, styles.statusLabel, { color: status.color }]} numberOfLines={1}>
							{status.label}
						</Text>
						<Text style={styles.summary} numberOfLines={1}>
							{` · ${summary.workers}`}
						</Text>
						{summary.needsYou ? (
							<Text style={[styles.summaryStrong, { color: t.amber }]} numberOfLines={1}>
								{` · ${summary.needsYou} need${summary.needsYou === 1 ? "s" : ""} you`}
							</Text>
						) : null}
					</View>

					{blocker ? (
						// Two texts so the ellipsis lands on the worker name, not the age.
						<View style={styles.blockerRow}>
							<Text style={styles.blockerWorker} numberOfLines={1}>
								{blocker.worker}
							</Text>
							<Text style={styles.blocker} numberOfLines={1}>
								{` · ${blocker.reason}`}
								{blocker.age ? ` · ${blocker.age}` : ""}
							</Text>
						</View>
					) : null}
				</View>
			</Pressable>

			<OrchestratorButton row={row} busy={busy} onPress={onOrchestrator} />
		</View>
	);
}

/**
 * The way into a project's orchestrator: open it when it runs, start or resume
 * it when it does not. Full width and solid, because on both the card and the
 * project page it is the action the surface exists for.
 */
export function OrchestratorButton({
	row,
	busy,
	onPress,
}: {
	row: OrchestratorProjectRow;
	busy: boolean;
	onPress: (row: OrchestratorProjectRow) => void;
}) {
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);
	const status = orchestratorStatus(t, row.link);
	const copy = orchestratorButtonCopy(row, busy);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${copy.label}, ${row.project.name}`}
			accessibilityState={{ busy, disabled: busy }}
			disabled={busy}
			onPress={() => onPress(row)}
			style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
		>
			{busy ? <ActivityIndicator size="small" color={t.bgBase} /> : <OrchestratorIcon size={17} color={t.bgBase} />}
			<Text maxFontSizeMultiplier={fontScaleCap.chrome} style={styles.buttonLabel} numberOfLines={1}>
				{copy.label}
			</Text>
			{/* A live orchestrator says so on the button itself, so "Open" never
			    reads as "Start". */}
			{copy.running ? <Dot color={status.color} size={7} breathing={status.breathing} /> : null}
		</Pressable>
	);
}

/**
 * The top of a project page: the orchestrator session itself — its state, what
 * it last did and when — above the button that opens it.
 */
export function ProjectOrchestratorPanel({
	row,
	busy,
	onPress,
}: {
	row: OrchestratorProjectRow;
	busy: boolean;
	onPress: (row: OrchestratorProjectRow) => void;
}) {
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);
	const status = orchestratorStatus(t, row.link);
	const blocker = projectBlockerLine(row);
	const timestamp = row.activityAt ? relativeTime(row.activityAt) : "";
	return (
		<View style={[styles.card, styles.panel]}>
			<View style={styles.panelHead}>
				<View style={styles.panelMark}>
					<OrchestratorIcon size={20} color={t.textPrimary} />
				</View>
				<View style={styles.main}>
					<View style={styles.titleRow}>
						<Text style={styles.panelTitle} numberOfLines={1}>
							Orchestrator
						</Text>
						{timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
					</View>
					<View style={styles.summaryRow}>
						<Dot color={status.color} size={6} breathing={status.breathing} />
						<Text style={[styles.summaryStrong, styles.statusLabel, { color: status.color }]} numberOfLines={1}>
							{status.label}
						</Text>
						{row.link?.harness ? (
							<Text style={styles.summary} numberOfLines={1}>
								{` · ${row.link.harness}`}
							</Text>
						) : null}
					</View>
				</View>
			</View>
			{/* The orchestrator's own summary of its fleet, in a sentence. */}
			<Text style={[styles.summary, styles.panelFacts]} numberOfLines={2}>
				{row.detail}
			</Text>
			{blocker ? (
				<View style={[styles.blockerRow, styles.panelBlocker]}>
					<Text style={styles.blockerWorker} numberOfLines={1}>
						{blocker.worker}
					</Text>
					<Text style={styles.blocker} numberOfLines={1}>
						{` · ${blocker.reason}`}
						{blocker.age ? ` · ${blocker.age}` : ""}
					</Text>
				</View>
			) : null}
			<View style={styles.panelAction}>
				<OrchestratorButton row={row} busy={busy} onPress={onPress} />
			</View>
		</View>
	);
}

const makeStyles = (t: Theme) =>
	StyleSheet.create({
		card: {
			marginHorizontal: 16,
			marginBottom: 12,
			borderRadius: 16,
			borderCurve: "continuous",
			backgroundColor: t.bgElevated,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: t.borderSubtle,
			overflow: "hidden",
		},
		body: { flexDirection: "row", alignItems: "stretch", gap: 10, paddingLeft: 12, paddingRight: 14, paddingTop: 14, paddingBottom: 12 },
		pressed: { backgroundColor: t.bgSubtle },
		rail: { width: 3, borderRadius: 2, alignSelf: "stretch", minHeight: 34 },
		main: { flex: 1, minWidth: 0, gap: 6 },

		titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
		project: { flex: 1, color: t.textPrimary, fontSize: 17, lineHeight: 22, fontWeight: "700", letterSpacing: -0.2 },
		timestamp: { color: t.textTertiary, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"], fontFamily: t.fontMono },

		summaryRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
		summaryStrong: { flexShrink: 0, fontSize: 12, lineHeight: 16, fontWeight: "600" },
		statusLabel: { marginLeft: 6 },
		summary: { flexShrink: 1, color: t.textTertiary, fontSize: 12, lineHeight: 16 },

		blockerRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
		blocker: { flexShrink: 0, color: t.textTertiary, fontSize: 12, lineHeight: 16 },
		blockerWorker: { flexShrink: 1, color: t.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: "600" },

		// Full width and solid: the one thing on the card that outranks the name.
		button: {
			marginHorizontal: 14,
			marginTop: 2,
			marginBottom: 14,
			minHeight: 44,
			borderRadius: 12,
			borderCurve: "continuous",
			backgroundColor: t.textPrimary,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 8,
			paddingHorizontal: 14,
		},
		buttonPressed: { opacity: 0.8 },
		panel: { marginTop: 8, marginBottom: 4 },
		panelHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: 14 },
		panelMark: { width: 40, height: 40, borderRadius: 12, borderCurve: "continuous", backgroundColor: t.bgSubtle, alignItems: "center", justifyContent: "center" },
		panelTitle: { flex: 1, color: t.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: "700" },
		panelFacts: { paddingHorizontal: 14, paddingTop: 12, fontSize: 13, lineHeight: 18, color: t.textSecondary },
		panelAction: { paddingTop: 12 },
		panelBlocker: { paddingHorizontal: 14, paddingTop: 4 },
		buttonLabel: { color: t.bgBase, fontSize: 15, lineHeight: 20, fontWeight: "700" },
	});
