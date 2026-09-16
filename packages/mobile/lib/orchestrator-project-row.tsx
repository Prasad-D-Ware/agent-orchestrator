import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { relativeTime } from "./notificationView";
import { OrchestratorRowAction } from "./orchestrator-row-actions";
import {
	orchestratorRowAccessibilityLabel,
	orchestratorStatus,
	orchestratorWorkerAccessibilityLabel,
	orchestratorWorkerPreviews,
	projectBlockerLine,
	projectRailTone,
	projectRowChips,
	type ProjectChipTone,
	type ProjectRailTone,
	type OrchestratorProjectRow,
} from "./orchestratorView";
import { attentionMetaFor, statusVisual, type Theme } from "./theme";
import { useTheme, useThemedStyles } from "./ThemeProvider";
import { fontScaleCap } from "./tokens";
import { Chip, Dot } from "./ui";

// Tones come from the pure module; colours are resolved here. Same split as
// agentsView's boardZoneOf (pure) against zoneMeta(t, zone) (themed).
function chipColors(t: Theme, tone: ProjectChipTone): { color: string; tint: string } {
	const meta = attentionMetaFor(t);
	if (tone === "attention") return { color: meta.action.color, tint: meta.action.tint };
	if (tone === "review") return { color: meta.review.color, tint: meta.review.tint };
	if (tone === "merge") return { color: meta.merge.color, tint: meta.merge.tint };
	return { color: meta.working.color, tint: meta.working.tint };
}

function railColor(t: Theme, tone: ProjectRailTone): string {
	if (tone === "attention") return t.amber;
	if (tone === "review") return t.red;
	if (tone === "working") return t.orange;
	if (tone === "idle") return t.green;
	return t.textFaint;
}

export function OrchestratorProjectRowView({
	row,
	busy,
	onOpen,
	onOpenWorker,
	onLaunch,
}: {
	row: OrchestratorProjectRow;
	busy: boolean;
	onOpen: (row: OrchestratorProjectRow) => void;
	onOpenWorker: (row: OrchestratorProjectRow, workerId: string) => void;
	onLaunch: (row: OrchestratorProjectRow) => void;
}) {
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);
	const status = orchestratorStatus(t, row.link);
	const timestamp = row.activityAt ? relativeTime(row.activityAt) : "";
	const running = row.action === "open";
	const chips = projectRowChips(row);
	const blocker = projectBlockerLine(row);
	const workerPreviews = running ? orchestratorWorkerPreviews(row.workers) : [];

	const content = (
		<>
			{/* Line 1 — the row's subject. The project name is the thing you scan
			    for, so nothing shares its weight. */}
			<View style={styles.titleRow}>
				<Text style={styles.project} numberOfLines={1}>
					{row.project.name}
				</Text>
				{/* Blue is the orchestrator's colour across the app, so the badge says
				    where the name leads without spending a sentence on it. */}
				<View style={styles.orchBadge}>
					<Text maxFontSizeMultiplier={fontScaleCap.chrome} style={styles.orchBadgeText}>
						Orchestrator
					</Text>
				</View>
				{timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
			</View>

			{/* Line 2 — counts as chips rather than prose. These numbers used to be
			    rendered in the quietest style on the row. */}
			{chips.length ? (
				<View style={styles.chipRow}>
					{chips.map((chip) => {
						const { color, tint } = chipColors(t, chip.tone);
						return <Chip key={chip.id} label={chip.label} color={color} tint={tint} />;
					})}
				</View>
			) : (
				<View style={styles.statusRow}>
					<Dot color={status.color} size={6} breathing={status.breathing} />
					<Text style={[styles.status, { color: status.color }]} numberOfLines={1}>
						{status.label}
					</Text>
					<Text style={styles.detail} numberOfLines={1}>
						{row.detail}
					</Text>
				</View>
			)}

			{/* Line 3 — the specific blocker, on attention rows only. This is what
			    the row was missing: which worker, waiting on what, how long. */}
			{blocker ? (
				// Two texts rather than one, so the ellipsis falls on the worker name
				// instead of the tail. A single truncating Text clipped the age — the
				// most perishable part of the line, and the reason it is worth showing
				// at all. The name is the one part repeated in the worker list below,
				// so it is the safe thing to shorten.
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
		</>
	);

	return (
		<View style={styles.row}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={orchestratorRowAccessibilityLabel(row.project.name, status.label, row.action)}
				accessibilityHint={blocker ? `${blocker.worker} ${blocker.reason}` : undefined}
				// Pressable in every state: tapping the name used to do nothing at all
				// on a project whose orchestrator was not running.
				onPress={() => (running ? onOpen(row) : onLaunch(row))}
				style={({ pressed }) => [styles.body, pressed && styles.pressed]}
			>
				{/* Leading rail carries state without spending a word on it, and
				    replaces the mascot that was identical on every row. */}
				<View style={[styles.rail, { backgroundColor: railColor(t, projectRailTone(row)) }]} />
				<View style={styles.main}>{content}</View>
				{/* One fixed trailing column in every state, so rows share a baseline
				    instead of wrapping text at two different measures. The action is
				    88x44 and clips silently on iOS if this is narrower. */}
				<View style={[styles.trailing, running && styles.trailingCompact]}>
					{running ? (
						<Feather name="chevron-right" size={16} color={t.textFaint} />
					) : (
						<OrchestratorRowAction
							action={row.action === "resume" ? "resume" : "start"}
							projectName={row.project.name}
							busy={busy}
							onPress={() => onLaunch(row)}
						/>
					)}
				</View>
			</Pressable>

			{workerPreviews.length ? (
				<View style={styles.workerList}>
					{/* A connector rail down the indent, so the nesting is drawn rather
					    than implied by whitespace. */}
					<View style={styles.workerRail} />
					{workerPreviews.map((worker) => {
						const workerStatus = statusVisual(t, worker.status);
						return (
							<Pressable
								key={worker.id}
								accessibilityRole="button"
								accessibilityLabel={orchestratorWorkerAccessibilityLabel(worker, workerStatus.label)}
								onPress={() => onOpenWorker(row, worker.id)}
								style={({ pressed }) => [styles.workerRow, pressed && styles.workerPressed]}
							>
								<Text style={styles.workerName} numberOfLines={1}>
									{worker.name}
								</Text>
								<View style={styles.workerStatus}>
									<Dot color={workerStatus.color} size={5} breathing={!!workerStatus.breathing} />
									<Text style={[styles.workerState, { color: workerStatus.color }]} numberOfLines={1}>
										{workerStatus.label}
									</Text>
								</View>
							</Pressable>
						);
					})}
				</View>
			) : null}
		</View>
	);
}

const makeStyles = (t: Theme) =>
	StyleSheet.create({
		row: {
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: t.borderSubtle,
		},
		// rail | content | fixed trailing — identical for every row state.
		body: { flexDirection: "row", alignItems: "stretch", minHeight: 72, paddingLeft: 14, paddingRight: 14, paddingVertical: 12, gap: 10 },
		pressed: { backgroundColor: t.bgSubtle },
		rail: { width: 3, borderRadius: 2, alignSelf: "stretch", minHeight: 34 },
		main: { flex: 1, minWidth: 0, gap: 5, justifyContent: "center" },
		trailing: { width: 88, alignItems: "flex-end", justifyContent: "center" },
		// Only the launch action needs the full column; the chevron does not.
		trailingCompact: { width: 20 },

		titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
		project: { flex: 1, color: t.textPrimary, fontSize: 17, lineHeight: 22, fontWeight: "700", letterSpacing: -0.2 },
		// Solid neutral fill with the page ground knocked out of the letters: the
		// badge is a label, not a state, so it stays out of the semantic palette the
		// rail and chips use to mean something.
		orchBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: t.textTertiary },
		orchBadgeText: { color: t.bgBase, fontSize: 10, lineHeight: 13, fontWeight: "700", letterSpacing: 0.3 },
		timestamp: { color: t.textTertiary, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"], fontFamily: t.fontMono },

		chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },

		statusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
		status: { flexShrink: 0, fontSize: 12, lineHeight: 16, fontWeight: "600" },
		detail: { flex: 1, color: t.textTertiary, fontSize: 12, lineHeight: 16 },

		blockerRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
		// flexShrink on the name, none on the reason+age: the tail must survive.
		blocker: { flexShrink: 0, color: t.textTertiary, fontSize: 12, lineHeight: 16 },
		blockerWorker: { flexShrink: 1, color: t.textPrimary, fontSize: 12, lineHeight: 16, fontWeight: "600" },

		workerList: { paddingLeft: 27, paddingRight: 14, paddingBottom: 8 },
		workerRail: { position: "absolute", left: 15, top: 0, bottom: 16, width: StyleSheet.hairlineWidth, backgroundColor: t.borderSubtle },
		workerRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 8, borderCurve: "continuous" },
		workerPressed: { backgroundColor: t.bgSubtle },
		workerStatus: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" },
		workerState: { flexShrink: 0, fontSize: 11, lineHeight: 15, fontWeight: "600" },
		workerName: { flex: 1, color: t.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: "500" },
	});
