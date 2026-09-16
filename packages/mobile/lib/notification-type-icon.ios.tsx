import { Icon } from "@expo/ui";
import { Host } from "@expo/ui/swift-ui";
import type { SFSymbol } from "sf-symbols-typescript";
import type { NotificationTypeIconProps } from "./notification-type-icon.types";

const symbols: Record<NotificationTypeIconProps["icon"], SFSymbol> = {
	comment: "bubble.left",
	"git-pull-request": "arrow.triangle.pull",
	"git-merge": "arrow.triangle.merge",
	// SF Symbols has no closed-pull-request glyph; the cross carries "closed".
	"git-pull-request-closed": "xmark.circle",
	bell: "bell",
};

export function NotificationTypeIcon({ icon, color }: NotificationTypeIconProps) {
	return (
		<Host matchContents>
			<Icon name={symbols[icon]} size={15} color={color} />
		</Host>
	);
}
