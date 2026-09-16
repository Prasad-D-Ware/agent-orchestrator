import { Icon } from "@expo/ui";
import type { SFSymbol } from "sf-symbols-typescript";
import type { SidebarDestination, SidebarDestinationId } from "./sidebar-navigation";

/**
 * Outline when idle, filled when selected — the iOS tab-bar idiom, which the
 * drawer was not using. Workers was `bolt.horizontal.circle`, which reads as
 * throughput rather than agents.
 */
const symbols: Record<SidebarDestinationId, { idle: SFSymbol; active: SFSymbol }> = {
	projects: { idle: "folder", active: "folder.fill" },
	agents: { idle: "cpu", active: "cpu.fill" },
	prs: { idle: "arrow.triangle.pull", active: "arrow.triangle.pull" },
	settings: { idle: "gearshape", active: "gearshape.fill" },
};

export function SidebarDestinationIcon({
	destination,
	color,
	active = false,
}: {
	destination: SidebarDestination;
	color: string;
	active?: boolean;
}) {
	const symbol = symbols[destination.id];
	return <Icon name={active ? symbol.active : symbol.idle} size={21} color={color} />;
}
