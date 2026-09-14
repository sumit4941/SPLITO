# SPLITO documentation

The feature matrix is the source of truth for what is implemented. Architecture
and operations documents describe both enforced invariants and the intended
production boundary; they do not imply that an unchecked feature is available.

## Design and contracts

- [Architecture](architecture.md)
- [Entity relationship model](erd.md)
- [Financial rules](financial-rules.md)
- [API conventions](api.md)
- [Dependency decisions](dependency-decisions.md)
- [Feature coverage matrix](feature-coverage-matrix.md)
- [Requirements checklist](requirements-checklist.md)
- [Performance evidence](performance-results.md)

## Operations

- [Windows local setup](operations/local-windows.md)
- [MongoDB setup and verification](operations/mongodb.md)
- [Migrations and forward recovery](operations/migrations.md)
- [Backup and restore](operations/backup-restore.md)
- [Deployment](operations/deployment.md)
- [Private attachment storage](operations/private-storage.md)
- [Optional providers](operations/providers.md)
- [Troubleshooting](operations/troubleshooting.md)

## Security

- [Threat model](security/threat-model.md)
- [ASVS verification map](security/asvs-verification.md)
- [Security status](security/security-report.md)
- [Data retention](security/data-retention.md)
