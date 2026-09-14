# MongoDB backup and restore

Backups must cover the MongoDB database, private image objects, encryption keys,
provider configuration, and deployment manifests. A database backup does not
contain image bytes stored by the private-media adapter.

For production Atlas, enable scheduled cloud backups and continuous backup or
point-in-time recovery where the selected tier supports them. Keep retention and
restore permissions separate from the runtime database user. Periodically export
backup metadata to an independent control plane and alert on failed snapshots.

Logical `mongodump` exports are useful for controlled migrations and selective
recovery, but they are not a replacement for managed snapshots and oplog-backed
point-in-time recovery. Encrypt every export and never place a URI containing
credentials in a command history or artifact name.

## Restore drill

1. Restore into a new isolated Atlas project/cluster or isolated database.
2. Record the source snapshot timestamp, target cluster, application commit, and
   expected recovery-point and recovery-time objectives.
3. Configure a temporary least-privilege database user and restricted IP access.
4. Run `npm run db:verify`, `npm run db:status`, and `npm run db:reconcile`.
5. Verify user/group/media counts, one-active-session uniqueness, OTP and
   invitation index rules, idempotency records, balanced ledger batches,
   projections, outbox backlog, and audit history.
6. Restore the matching private-media objects and confirm authorized image reads.
7. Exercise login, group membership, expense editing, settlement, and worker
   delivery before approving the drill.
8. Revoke temporary credentials and delete the isolated target according to the
   retention policy.

Document evidence without tokens, passwords, complete connection strings,
session hashes, OTP hashes, or private media.

See [Atlas backup, restore, and archive](https://www.mongodb.com/docs/atlas/backup-restore-cluster/).
