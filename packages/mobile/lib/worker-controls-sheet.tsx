import { BottomSheet, Button, Column, Picker, Row, Spacer, Text } from "@expo/ui";
import type { ProjectInfo } from "./api";
import { haptics } from "./haptics";
import { ALL_WORKER_PROJECTS } from "./worker-controls";
import { useTheme } from "./ThemeProvider";

export function WorkerControlsSheet({
	open,
	onDismiss,
	onSearch,
	projects,
	selectedProjectId,
	onSelectProject,
}: {
	open: boolean;
	onDismiss: () => void;
	onSearch: () => void;
	projects: ProjectInfo[];
	selectedProjectId: string;
	onSelectProject: (projectId: string) => void;
}) {
	const t = useTheme();

	return (
		<BottomSheet
			isPresented={open}
			onDismiss={onDismiss}
			showDragIndicator
			snapPoints={[{ height: 260 }]}
			contentPadding={{ top: 20, bottom: 28, left: 20, right: 20 }}
			testID="worker-controls-sheet"
		>
			<Column spacing={18} style={{ width: "100%" }}>
				<Column spacing={4}>
					<Text textStyle={{ color: t.textPrimary, fontSize: 22, fontWeight: "700" }}>Workers</Text>
					<Text textStyle={{ color: t.textTertiary, fontSize: 13 }}>Find and scope the workers on this screen.</Text>
				</Column>

				<Button
					label="Search workers"
					variant="outlined"
					testID="worker-controls-search"
					style={{ width: "100%", height: 48, borderRadius: 16 }}
					onPress={() => {
						haptics.tap();
						onDismiss();
						setTimeout(onSearch, 280);
					}}
				/>

				<Row alignment="center" spacing={12} style={{ width: "100%", paddingHorizontal: 4 }}>
					<Column spacing={2}>
						<Text textStyle={{ color: t.textPrimary, fontSize: 16, fontWeight: "600" }}>Projects</Text>
						<Text textStyle={{ color: t.textTertiary, fontSize: 12 }}>Filter this Workers list only</Text>
					</Column>
					<Spacer flexible />
					<Picker
						selectedValue={selectedProjectId}
						onValueChange={(projectId) => {
							haptics.select();
							onSelectProject(String(projectId));
						}}
						appearance="menu"
						testID="worker-project-filter"
					>
						<Picker.Item label="All projects" value={ALL_WORKER_PROJECTS} />
						{projects.map((project) => (
							<Picker.Item key={project.id} label={project.name} value={project.id} />
						))}
					</Picker>
				</Row>
			</Column>
		</BottomSheet>
	);
}
