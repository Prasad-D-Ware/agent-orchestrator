import { Octicons } from "@expo/vector-icons";
import type { NotificationTypeIconProps } from "./notification-type-icon.types";

/**
 * No RNHostView: this path is Android's, and hosting a vector glyph inside a
 * Compose view renders nothing — which is why these rows had no icon at all.
 */
export function NotificationTypeIcon({ icon, color }: NotificationTypeIconProps) {
	return <Octicons name={icon} size={15} color={color} />;
}
