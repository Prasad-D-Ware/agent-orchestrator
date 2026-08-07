import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ConnectMobileSetup } from "./ConnectMobileSetup";

test("renders the LAN steps when the mode is lan", () => {
	render(<ConnectMobileSetup mode="lan" onModeChange={vi.fn()} enabled={true} />);
	expect(screen.getByText(/same Wi-Fi as this computer/i)).toBeInTheDocument();
	expect(screen.queryByText(/tailscale ip -4/i)).not.toBeInTheDocument();
});

test("renders the Tailscale steps when the mode is tailscale", () => {
	render(<ConnectMobileSetup mode="tailscale" onModeChange={vi.fn()} enabled={true} />);
	expect(screen.getByText(/tailscale ip -4/i)).toBeInTheDocument();
	expect(screen.getByText(/scan the code below/i)).toBeInTheDocument();
});

test("reports the selected mode to its parent rather than keeping it locally", async () => {
	const onModeChange = vi.fn();
	render(<ConnectMobileSetup mode="lan" onModeChange={onModeChange} enabled={true} />);
	await userEvent.click(screen.getByRole("radio", { name: "Tailscale" }));
	expect(onModeChange).toHaveBeenCalledWith("tailscale");
});

test("segments leave the tab order while the bridge is disabled", () => {
	render(<ConnectMobileSetup mode="lan" onModeChange={vi.fn()} enabled={false} />);
	expect(screen.getByRole("radio", { name: "LAN" })).toHaveAttribute("tabindex", "-1");
});
