import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { relativeTime } from "./notificationView";
import { OrchestratorRowAction } from "./orchestrator-row-actions";
import {
	orchestratorRowAccessibilityLabel,
	orchestratorStatus,
	orchestratorWorkerAccessibilityLabel,
	orchestratorWorkerPreviews,
	type OrchestratorProjectRow,
} from "./orchestratorView";
import { statusVisual, type Theme } from "./theme";
import { useTheme, useThemedStyles } from "./ThemeProvider";
import { Dot } from "./ui";

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
	const workerPreviews = orchestratorWorkerPreviews(row.workers);
	const content = (
		<>
			<View style={styles.eyebrow}>
				<Feather name="folder" size={14} color={t.textSecondary} />
				<Text style={styles.project} numberOfLines={1}>
					{row.project.name}
				</Text>
				{timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
			</View>
			<View style={styles.headlineRow}>
				<Text style={styles.headline} numberOfLines={1}>
					{row.headline}
				</Text>
				{running ? <Feather name="chevron-right" size={15} color={t.textFaint} /> : null}
			</View>
			<View style={styles.detailRow}>
				<Dot color={status.color} size={6} breathing={status.breathing} />
				<Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
				<Text style={styles.detail} numberOfLines={2}>
					· {row.detail}
				</Text>
			</View>
		</>
	);

	return (
		<View style={styles.row}>
			{running ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={orchestratorRowAccessibilityLabel(row.project.name, status.label, row.action)}
					onPress={() => onOpen(row)}
					style={({ pressed }) => [styles.content, styles.runningContent, pressed && styles.pressed]}
				>
					{content}
				</Pressable>
			) : (
				<View style={[styles.content, styles.actionContent]}>{content}</View>
			)}

			{!running ? (
				<View style={styles.trailingAction}>
					<OrchestratorRowAction
						action={row.action === "resume" ? "resume" : "start"}
						projectName={row.project.name}
						busy={busy}
						onPress={() => onLaunch(row)}
					/>
				</View>
			) : null}

			{workerPreviews.length ? (
				<View style={styles.workerList} accessibilityRole="summary">
					{workerPreviews.map((worker) => {
						const workerStatus = statusVisual(t, worker.state);
						return (
							<Pressable
								key={worker.id}
								accessibilityRole="button"
								accessibilityLabel={orchestratorWorkerAccessibilityLabel(worker)}
								onPress={() => onOpenWorker(row, worker.id)}
								style={({ pressed }) => [styles.workerRow, pressed && styles.workerPressed]}
							>
								<Dot color={workerStatus.color} size={5} breathing={worker.state === "working"} />
								<Text style={[styles.workerState, { color: workerStatus.color }]}>{workerStatus.label}</Text>
								<Text style={styles.workerName} numberOfLines={1}>
									{worker.name}
								</Text>
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
			minHeight: 92,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: t.borderSubtle,
			justifyContent: "center",
		},
		content: { minHeight: 92, paddingHorizontal: 18, paddingVertical: 11, gap: 3, justifyContent: "center" },
		runningContent: { paddingRight: 18 },
		actionContent: { paddingRight: 118 },
		pressed: { backgroundColor: t.bgSubtle },
		eyebrow: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 17 },
		project: { flex: 1, color: t.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.15 },
		timestamp: { color: t.textTertiary, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] },
		headlineRow: { flexDirection: "row", alignItems: "center", gap: 4 },
		headline: { flexShrink: 1, color: t.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: "600" },
		detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, minHeight: 16 },
		status: { flexShrink: 0, fontSize: 12, lineHeight: 16, fontWeight: "600" },
		detail: { flex: 1, color: t.textTertiary, fontSize: 12, lineHeight: 16 },
		trailingAction: { position: "absolute", right: 14, top: 0, height: 92, minWidth: 44, justifyContent: "center" },
		workerList: { paddingLeft: 38, paddingRight: 12, paddingBottom: 8, gap: 2 },
		workerRow: { minHeight: 27, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, borderRadius: 7, borderCurve: "continuous" },
		workerPressed: { backgroundColor: t.bgSubtle },
		workerState: { width: 47, fontSize: 11, lineHeight: 15, fontWeight: "500" },
		workerName: { flex: 1, color: t.textSecondary, fontSize: 12, lineHeight: 16 },
	});
