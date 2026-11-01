# Pigeon Node (preview)

Connect a Windows or Linux computer/server to the **Pigeon** Cloudflare device network.

Pigeon is separated into two components:
- The public hosted MCP server is in Cloudflare and uses GitHub login.
- This package starts the **local node** on a computer or server. Installing a ChatGPT plugin alone does not start a local node.

## Try from npm (after publication)

Requires Node.js **22+**.

```sh
npx @luoluoluo22/pigeon-node@latest connect
```

`connect` creates a local private signing key (on first run), takes a one-time binding code, and then runs in the foreground. Separate `setup` and `run` commands are also available. Generate the code at https://pigeon-dev.a1137583371.workers.dev/admin/ after GitHub login.

The `run` command keeps a signed outbound WebSocket connected while the process is running. Stop it with Ctrl+C. It does **not** silently install system services.

## Servers (Linux)

For a durable process, **install a pinned version** into a trusted location and manage it with systemd:

```sh
npm install --global @luoluoluo22/pigeon-node@0.1.0
pigeon-node setup
pigeon-node run
```

Use the machine owner's unprivileged user and a persistent home directory. Put `pigeon-node run` in a user-owned systemd service after verifying the absolute executable path with `command -v pigeon-node`. Avoid running the connector as root.

## Other commands

`pigeon-node status` — inspect local identity registration.

`pigeon-node doctor` — check local presence of a device identity (does not connect to Cloudflare).

`pigeon-node init` and `pigeon-node enroll` — individual enrollment stages.

## Current security and functionality

- P-256 device identity is generated and stored on the local machine (`PIGEON_NODE_HOME` overrides the directory).
- The cloud uses per-device signature verification, owner-scoped device listings and WebSocket channels.
- No remote command execution or filesystem APIs.
- Only small text test messages are supported currently. **No file transfer, remote control or E2EE**.
- Public npm release and public GitHub account onboarding remain pending. This package is a pre-publication candidate.

License: not yet selected for public distribution. Do not repackage it as an official signed installer.
