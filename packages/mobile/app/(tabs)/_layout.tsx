import { Stack } from "expo-router/stack";
import { SidebarNavigationShell } from "../../lib/sidebar-navigation-shell";
import { useTheme } from "../../lib/ThemeProvider";

export default function SidebarLayout() {
	const t = useTheme();
	return (
		<SidebarNavigationShell>
			<Stack screenOptions={{ headerShown: false, animation: "none" }}>
				<Stack.Screen
					name="settings"
					options={{
						presentation: "pageSheet",
						animation: "default",
						contentStyle: { backgroundColor: t.bgSurface },
					}}
				/>
			</Stack>
		</SidebarNavigationShell>
	);
}
