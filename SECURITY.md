# Security

Never include credentials, customer records, payroll, database exports or attachments in public issues. Use GitHub private vulnerability reporting when available; otherwise contact the maintainer through the repository profile to agree on a private reporting channel before sending sensitive details.

This initial product release has not undergone an independent penetration test. Operators own HTTPS, host patching, database isolation, backup/restore, access reviews and incident response. Review changes and the release notes before upgrading. A support agreement does not replace customer configuration or payroll review.

Core controls include session validation, CSRF/origin checking, workspace-scoped permissions, encrypted integration tokens, server timestamps for clock events, payroll approval snapshots and audit records. These controls must be tested in each deployment.

Run `node scripts/public-release-scan.mjs --staged` immediately before a public push. The scanner is a defense against accidental publication, not a guarantee that arbitrary new files contain no secrets. Also inspect the staged diff and dependency licenses.
