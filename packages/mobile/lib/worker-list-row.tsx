import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DashboardSession } from "./api";
import { AgentLogo } from "./AgentLogo";
import { haptics } from "./haptics";
import { prLine, workerRowPresentation } from "./agentsView";
import { toneColor } from "./prView";
import { statusVisual, type Theme } from "./theme";
import { useTheme, useThemedStyles } from "./ThemeProvider";

export function WorkerListRow({ session, projectName }: { session: DashboardSession; projectName?: string }) {
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);
	const router = useRouter();
	const row = workerRowPresentation(t, session, projectName);
	const visual = statusVisual(t, session.status);
	const prs = prLine(session);
	const details = [row.branch, prs?.text].filter(Boolean).join("  ·  ");

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${row.title}. ${visual.label}. ${row.project}.`}
			onPress={() => {
				haptics.tap();
				router.push({
					pathname: "/session/[id]",
					params: { id: session.id, projectId: session.projectId },
				});
			}}
			style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
		>
			<View style={styles.eyebrow}>
				<AgentLogo harness={session.harness} size={14} />
				<Text style={styles.project} numberOfLines={1}>
					{row.project}
				</Text>
				<Text
					style={[
						styles.trailing,
						{ color: row.trailingKind === "status" ? visual.color : t.textTertiary },
					]}
					numberOfLines={1}
				>
					{row.trailing}
				</Text>
			</View>

			<Text style={styles.title} numberOfLines={1}>
				{row.title}
			</Text>

			{details ? (
				<Text style={[styles.details, prs && !row.branch && { color: toneColor(t, prs.tone) }]} numberOfLines={1}>
					{details}
				</Text>
			) : null}
		</Pressable>
	);
}

const makeStyles = (t: Theme) =>
	StyleSheet.create({
		row: {
			minHeight: 76,
			paddingHorizontal: 18,
			paddingVertical: 10,
			gap: 3,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: t.borderSubtle,
		},
		rowPressed: { backgroundColor: t.bgSubtle },
		eyebrow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 17 },
		project: { flex: 1, color: t.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: "500" },
		trailing: { flexShrink: 0, fontSize: 12, lineHeight: 16, fontWeight: "500", fontVariant: ["tabular-nums"] },
		title: { color: t.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.15 },
		details: { color: t.textTertiary, fontSize: 12, lineHeight: 16, fontFamily: t.fontMono },
	});
