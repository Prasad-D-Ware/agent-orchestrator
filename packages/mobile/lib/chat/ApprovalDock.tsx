import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { haptics } from "../haptics";
import type { Theme } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeProvider";
import { fontScaleCap } from "../tokens";
import { dockCanResolve, type ApprovalDockModel } from "./approvalDockModel";
import { actionControlWidth } from "./chatPresentation";

/**
 * Keeps a pending request reachable while the agent is blocked on it.
 *
 * The full card stays in the timeline — it owns the command detail, the cwd, and
 * for an elicitation the whole multi-question form. But the timeline scrolls,
 * and the moment you read back or the agent emits more output, the one thing
 * stopping it goes off screen. This sits above the composer until the request is
 * answered.
 *
 * Approvals with decisions can be answered here. Input requests cannot: their
 * card owns fields and validation, so the dock offers Answer, which jumps to it.
 */
export function ApprovalDock({
	model,
	onDecide,
	onShow,
}: {
	model: ApprovalDockModel;
	onDecide(requestId: string, decisionId: string): Promise<void>;
	onShow(sequence: number): void;
}) {
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);
	const [submitting, setSubmitting] = useState<string>();
	const [error, setError] = useState<string>();
	const canResolve = dockCanResolve(model);
	const tone = model.kind === "approval" ? t.amber : t.blue;

	return (
		<View accessibilityRole="alert" style={[styles.dock, { borderTopColor: tone }]}>
			<View style={styles.headline}>
				<Feather name={model.kind === "approval" ? "shield" : "message-circle"} size={13} color={tone} />
				<Text maxFontSizeMultiplier={fontScaleCap.chrome} style={[styles.title, { color: tone }]}>
					{model.title}
				</Text>
				{/* Always available, even when the dock can resolve: the card carries
				    the reason and cwd that the summary line cannot. */}
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Show the request in the conversation"
					hitSlop={8}
					onPress={() => {
						haptics.tap();
						onShow(model.sequence);
					}}
				>
					<Text maxFontSizeMultiplier={fontScaleCap.chrome} style={styles.show}>
						{canResolve ? "Show" : "Answer"}
					</Text>
				</Pressable>
			</View>

			{model.summary ? (
				<Text numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.chrome} style={styles.summary}>
					{model.summary}
				</Text>
			) : null}

			{canResolve ? (
				<View style={styles.actions}>
					{model.decisions.map((decision, index) => {
						const busy = model.busy || Boolean(submitting);
						const label = submitting === decision.id ? "Sending…" : decision.label;
						const primary = index === 0;
						return (
							<Pressable
								key={decision.id}
								accessibilityRole="button"
								accessibilityLabel={decision.label}
								accessibilityState={{ disabled: busy }}
								disabled={busy}
								onPress={() => {
									haptics.tap();
									setSubmitting(decision.id);
									setError(undefined);
									void onDecide(model.requestId ?? "", decision.id)
										.catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
										.finally(() => setSubmitting(undefined));
								}}
								// Same sizing rule as the inline card's buttons, so the two
								// read as one control in two places.
								style={({ pressed }) => [
									styles.action,
									{ width: actionControlWidth(label, primary) },
									primary ? { backgroundColor: tone } : styles.actionSecondary,
									pressed && styles.actionPressed,
									busy && styles.actionDisabled,
								]}
							>
								{submitting === decision.id ? (
									<ActivityIndicator size="small" color={primary ? t.onAccent : t.textSecondary} />
								) : (
									<Text
										numberOfLines={1}
										maxFontSizeMultiplier={fontScaleCap.chrome}
										style={[styles.actionText, primary ? { color: t.onAccent } : { color: t.textPrimary }]}
									>
										{label}
									</Text>
								)}
							</Pressable>
						);
					})}
				</View>
			) : null}

			{error ? (
				<Text accessibilityRole="alert" style={styles.error}>
					{error}
				</Text>
			) : null}
		</View>
	);
}

const makeStyles = (t: Theme) =>
	StyleSheet.create({
		// A top border in the request's tone rather than a filled bar: this sits
		// directly above the composer, and a solid block there competes with it.
		dock: {
			gap: 6,
			paddingHorizontal: 12,
			paddingVertical: 9,
			borderTopWidth: 2,
			backgroundColor: t.bgSurface,
		},
		headline: { flexDirection: "row", alignItems: "center", gap: 7 },
		title: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: "700" },
		show: { color: t.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: "700" },
		summary: { color: t.textSecondary, fontSize: 12, lineHeight: 16, fontFamily: t.fontMono },
		actions: { flexDirection: "row", gap: 8, marginTop: 1 },
		action: { minHeight: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
		actionSecondary: { backgroundColor: t.bgElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: t.borderDefault },
		actionPressed: { opacity: 0.72 },
		actionDisabled: { opacity: 0.5 },
		actionText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
		error: { color: t.red, fontSize: 11, lineHeight: 15 },
	});
