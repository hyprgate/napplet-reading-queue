<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `reading-queue` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# Reading Queue

Save notes, articles, people, relays and web links to come back to. Paste a `note1`,
`nevent1`, `naddr1`, `npub1`, `nprofile1`, `wss://` or `https://` reference. Other apps
can also send items over the `reading-queue:add` INC topic.

The source lives in the Hyprgate monorepo at `napplets/reading-queue`. The standalone
`hyprgate/napplet-reading-queue` repository is a generated, read-only mirror, so send
changes to [hyprgate/web](https://github.com/hyprgate/web).

## Developing

Run these from the root of a Hyprgate checkout so workspace dependencies resolve:

```bash
pnpm install --frozen-lockfile
pnpm --filter ./napplets/reading-queue paja        # Kehto Paja plus the Vite dev server
pnpm --filter ./napplets/reading-queue test
pnpm --filter ./napplets/reading-queue type-check
pnpm --filter ./napplets/reading-queue conformance # builds, then checks dist/
```

Forms never submit under the `allow-scripts` sandbox, so use a button `onclick` and
handle Enter on the input.
