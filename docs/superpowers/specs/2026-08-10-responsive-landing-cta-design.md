# Responsive Landing CTA Design

## Goal

Remove the landing-page download CTA flicker while showing copy appropriate to the viewport:

- Below the Tailwind `md` breakpoint (`768px`): `Get AO Mobile`
- At and above `768px`: `Get AO Desktop`

## Design

`DownloadButton` will render both text variants in the initial HTML and use responsive Tailwind display classes to select the visible variant. Visible CTA content will not depend on `navigator`, `useEffect`, or React platform state, so the server-rendered and hydrated markup remain identical.

Both variants continue to use the existing `/download` destination. The button will use one platform-neutral icon because the action leads to the shared download page rather than directly downloading an OS-specific artifact.

Platform detection may remain available elsewhere, including the download page, but it will not control the landing CTA's visible content or analytics payload.

## Verification

- A component regression test will assert that both exact labels and their responsive visibility classes are rendered.
- Landing TypeScript validation will pass.
- The landing production build will be attempted; any pre-existing dependency failure will be reported separately.

## Scope

No download-page behavior, routing, release URLs, or unrelated landing components will change.
