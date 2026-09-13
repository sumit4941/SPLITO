# Backup and restore guide

Backups are a database/platform-owner responsibility and must cover the Oracle
CDB/PDB, encryption keys/wallets, private attachments, deployment configuration,
and provider-secret references. A successful backup command is not restore
evidence.

## Policy baseline

Define approved RPO/RTO per environment before launch. A reasonable starting
exercise target is an RPO of 15 minutes and an RTO of 4 hours, but this is not a
measured commitment. Retain multiple generations, keep an isolated/immutable
copy, encrypt in transit and at rest, restrict backup roles, and alert on missed
or unvalidated backups.

Use RMAN physical backups as the recovery foundation. Data Pump export of
`SPLITO_OWNER` is a useful logical supplement for schema inspection or selective
recovery, not a replacement for physical/redo coverage. Oracle documents PDB
backup with `BACKUP PLUGGABLE DATABASE FREEPDB1` when connected to the root and
restore validation with `RESTORE PLUGGABLE DATABASE ... VALIDATE`.

References:

- [Oracle 26ai backup and recovery guide](https://docs.oracle.com/en/database/oracle/oracle-database/26/bradv/)
- [Backing up a PDB](https://docs.oracle.com/en/database/oracle/oracle-database/26/bradv/backing-up-database.html)
- [Validating database files and backups](https://docs.oracle.com/en/database/oracle/oracle-database/26/bradv/validating-database-files-backups.html)

## Restore exercise

1. Open an incident/change record and choose an isolated target. Do not overwrite
   production during a test.
2. Record source backup identifiers, checksums, SCN/time, Oracle patch level,
   wallet/key versions, attachment snapshot, and application commit.
3. Restore/recover the CDB or `FREEPDB1` to the target using the approved RMAN
   procedure. Restore private objects to an isolated bucket/volume with no public
   access.
4. Connect with a temporary recovery credential and confirm PDB/open mode,
   schema migration history/checksums, invalid objects, constraints, row counts,
   and attachment hashes.
5. Run `validate-schema.mjs`, report-only journal/projection reconciliation,
   authorization smoke tests, and sampled receipt retrieval. If a mismatch is
   found, rehearse the explicit rebuild on this isolated copy before production.
6. Verify recovery-point age and elapsed recovery time against RPO/RTO. Capture
   evidence and destroy the isolated copy under policy.
7. Resolve every discrepancy before marking the backup system healthy.

Point-in-time recovery after a financial corruption must coordinate database and
private-object versions. Never copy only projection tables as a recovery; rebuild
them from the restored immutable journal. Never import seed data into a restored
production schema.

## Current status

This repository supplies the procedure and schema validation hooks. No backup or
restore was executed during repository construction, so RPO/RTO and restore
success remain unverified.
