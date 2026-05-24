# 0001 Track Pi config in GitHub

## Status

Accepted

## Decision

Track the durable parts of the Pi configuration in a public GitHub repository named `.pi`.

Use GitHub Issues for candidate config choices and setup backlog. Use markdown decision records in `docs/decisions/` for settled choices and rationale.

## Rationale

The Pi setup is expected to evolve through evaluation of external skills, extensions, and workflows. Issues are good for candidate work and discussion, but final choices should live in committed markdown so future agents can understand the setup without reconstructing history from issue threads.

## Consequences

- Secrets, auth files, sessions, caches, and package installs must be ignored.
- Config choices should move through: GitHub Issue → evaluation → decision markdown → config change.
- The repo should remain understandable to a fresh agent reading only the checked-in files.
