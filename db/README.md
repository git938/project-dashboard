# Database

See ../README.md for deployment and API setup. Local MySQL runs on 127.0.0.1:3306 with database projects and the requested admin/admin account. Credentials are held in the ignored .env.

The Mac helper scripts/mysql-local.sh manages the isolated instance in .local/mysql using the installed MySQL 8.0.16 binary. It never resets data. This runtime and its private configuration are not part of the deployment.

Run npm run db:migrate --prefix api for schema.sql plus version migrations. Optionally run CONFIRM_DEMO_SEED=yes npm run db:seed --prefix api. Seed preserves existing IDs and copies the demonstration attachment.

Fixtures: 4 projects, 24 issues, 3 teams, 8 members, 6 milestones, 5 notes, 4 documents and 6 events. UTC timestamps and Asia/Tokyo event timezone. Dates are relative to the first seed run.
