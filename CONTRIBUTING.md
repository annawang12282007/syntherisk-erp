# Contributing

Use Node.js 24 and the lockfile. Work in an isolated installation with synthetic data. Do not point tests at a business database. Read `AGENTS.md` and the bundled framework documentation before editing framework-dependent code.

Export verification also requires Python 3.12. In a Python virtual environment, run `python -m pip install -r requirements-test.txt` to install the pinned independent XLSX/PDF readers. Set `QA_PYTHON` to the interpreter's absolute path if it is not the default Python. The application itself does not need Python.

Contributions are accepted under AGPL-3.0-only. Preserve third-party copyright and license notices. Submit source only: no `.env`, keys, screenshots of real customer data, exports, company configuration snapshots or build output. Describe behavioral changes and meaningful test evidence in each pull request.

For workforce changes, test identity/tenant isolation, permission revocation, concurrent punches, date boundaries, integer money calculations, unsupported payroll cases and immutable approvals. Update the Taiwan rule document when applicable. Verify UI behavior against a disposable local fixture.

Run `pnpm typecheck`, `pnpm test:node`, `pnpm test:isolated`, `pnpm build`, and `pnpm release:check`. Stage only intended files, then run `node scripts/public-release-scan.mjs --staged`. Supply any private release markers through the newline-delimited `PRIVATE_RELEASE_MARKERS` environment variable locally; do not commit those values or place them in public CI. Never use production credentials in tests or CI.
