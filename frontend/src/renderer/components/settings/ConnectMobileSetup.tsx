import { useTranslation } from "react-i18next";
import { RadioGroup } from "radix-ui";

export type SetupMode = "lan" | "tailscale";

interface ConnectMobileSetupProps {
	/** The selected connection method. Owned by the modal, which encodes the
	 *  matching address into the pairing QR. */
	mode: SetupMode;
	onModeChange: (mode: SetupMode) => void;
	/**
	 * False while the bridge is off; the steps are then collapsed, so their
	 * controls must leave the tab order (same pattern as the pairing block).
	 */
	enabled: boolean;
}

// ConnectMobileSetup tells the user what to do with the pairing QR above it and
// which address that QR carries. The mode is owned by ConnectMobileModal so the
// QR can re-encode: LAN mode encodes the private IPv4 from AutopickLANIP, and
// Tailscale mode encodes the 100.64.0.0/10 address from AutopickTailscaleIP
// (backend/internal/mobilebridge/netiface.go).
export function ConnectMobileSetup({ mode, onModeChange, enabled }: ConnectMobileSetupProps) {
	const { t } = useTranslation();

	// Margin-free on purpose: the modal owns the spacing around this block.
	return (
		<div className="flex w-full flex-col items-center">
			<RadioGroup.Root
				value={mode}
				onValueChange={(value) => onModeChange(value as SetupMode)}
				aria-label={t("mobile.connectionMethod")}
				className="settings-segment"
			>
				<RadioGroup.Item value="lan" tabIndex={enabled ? 0 : -1} className="settings-segment-item">
					{t("mobile.lan")}
				</RadioGroup.Item>
				<RadioGroup.Item value="tailscale" tabIndex={enabled ? 0 : -1} className="settings-segment-item">
					{t("mobile.tailscale")}
				</RadioGroup.Item>
			</RadioGroup.Root>

			{mode === "lan" ? (
				<div className="mt-3 w-full px-(--size-settings-mobile-details-pad-x)">
					<ol className="settings-mobile-steps">
						<li>{t("mobile.lan.step1")}</li>
						<li>{t("mobile.lan.step2")}</li>
						<li>{t("mobile.lan.step3")}</li>
					</ol>
				</div>
			) : (
				<div className="mt-3 w-full px-(--size-settings-mobile-details-pad-x)">
					<ol className="settings-mobile-steps">
						<li>{t("mobile.tailscale.step1")}</li>
						<li>
							{t("mobile.tailscale.step2Lead")}{" "}
							<span className="tracking-settings-mono text-settings-label">tailscale ip -4</span>{" "}
							{t("mobile.tailscale.step2Trail")}
						</li>
						<li>{t("mobile.tailscale.step3")}</li>
					</ol>
				</div>
			)}
		</div>
	);
}
