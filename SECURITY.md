# Security Notes

## Skymavis API key exposure

Treat every Skymavis API key previously present in this project as compromised,
even if the repository was private or a file was later removed.

Before any GitHub publication:

1. Rotate all exposed keys in the Skymavis dashboard.
2. Confirm the old keys are revoked.
3. Search the clean tree and history for key-shaped values.
4. Publish only from a fresh repository history containing the cleaned tree.

Keep credentials only in ignored `.env*` files, shell environment variables, or
a deployment secret manager. Never commit keys in documentation, scripts,
fixtures, screenshots, or commit messages.