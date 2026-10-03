-- Initial schema for Project Workspace (MySQL 8.0).
-- Run once on an empty database. Apply later changes using migrations.
-- The DBA creates database projects and the app user separately.
USE projects;
SET NAMES utf8mb4;

CREATE TABLE members (
 id VARCHAR(64) PRIMARY KEY,
 name VARCHAR(160) NOT NULL,
 role VARCHAR(160) NOT NULL DEFAULT '',
 email VARCHAR(254) NULL,
 avatar_storage_key VARCHAR(255) NULL,
 avatar_mime VARCHAR(100) NULL,
 color CHAR(7) NOT NULL DEFAULT '#e7e2f3',
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE teams (
 id VARCHAR(64) PRIMARY KEY,
 name VARCHAR(160) NOT NULL,
 description TEXT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE team_members (
 team_id VARCHAR(64) NOT NULL,
 member_id VARCHAR(64) NOT NULL,
 PRIMARY KEY(team_id,member_id),
 FOREIGN KEY(team_id) REFERENCES teams(id),
 FOREIGN KEY(member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE projects (
 id VARCHAR(64) PRIMARY KEY,
 name VARCHAR(160) NOT NULL,
 description TEXT NULL,
 status ENUM('Active','On hold','Completed','Archived') NOT NULL DEFAULT 'Active',
 manager_id VARCHAR(64) NULL,
 team_id VARCHAR(64) NULL,
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 color CHAR(7) NOT NULL DEFAULT '#aaa0ce',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(manager_id) REFERENCES members(id),
 FOREIGN KEY(team_id) REFERENCES teams(id),
 CHECK(end_date >= start_date),
 INDEX projects_status(status,deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE project_members (
 project_id VARCHAR(64) NOT NULL,
 member_id VARCHAR(64) NOT NULL,
 PRIMARY KEY(project_id,member_id),
 FOREIGN KEY(project_id) REFERENCES projects(id),
 FOREIGN KEY(member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE issues (
 id VARCHAR(64) PRIMARY KEY,
 project_id VARCHAR(64) NOT NULL,
 name VARCHAR(160) NOT NULL,
 description TEXT NULL,
 phase ENUM('Discovery','Design','Development','Launch') NOT NULL DEFAULT 'Development',
 status ENUM('Backlog','Todo','In Progress','Review','Done') NOT NULL DEFAULT 'Todo',
 assignee_id VARCHAR(64) NULL,
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 sort_order INT NOT NULL DEFAULT 0,
 progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id),
 FOREIGN KEY(assignee_id) REFERENCES members(id),
 CHECK(end_date >= start_date),
 CHECK(progress <= 100),
 INDEX issues_board(project_id,status,deleted_at),
 INDEX issues_schedule(project_id,start_date,end_date),
 INDEX issues_assignee(assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE milestones (
 id VARCHAR(64) PRIMARY KEY,
 project_id VARCHAR(64) NOT NULL,
 name VARCHAR(160) NOT NULL,
 date DATE NOT NULL,
 status ENUM('Planned','Completed') NOT NULL DEFAULT 'Planned',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id),
 INDEX milestones_date(project_id,date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE notes (
 id VARCHAR(64) PRIMARY KEY,
 project_id VARCHAR(64) NULL,
 owner_id VARCHAR(64) NULL,
 name VARCHAR(160) NOT NULL,
 content MEDIUMTEXT NOT NULL,
 tag VARCHAR(64) NOT NULL DEFAULT '',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id),
 FOREIGN KEY(owner_id) REFERENCES members(id),
 INDEX notes_project(project_id,deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE documents (
 id VARCHAR(64) PRIMARY KEY,
 project_id VARCHAR(64) NOT NULL,
 name VARCHAR(160) NOT NULL,
 category VARCHAR(64) NOT NULL DEFAULT 'Other',
 kind ENUM('note','file') NOT NULL,
 content MEDIUMTEXT NULL,
 original_name VARCHAR(255) NULL,
 storage_key VARCHAR(255) NULL,
 mime_type VARCHAR(100) NULL,
 size_bytes BIGINT UNSIGNED NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id),
 INDEX documents_project(project_id,deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE events (
 id VARCHAR(64) PRIMARY KEY,
 project_id VARCHAR(64) NOT NULL,
 title VARCHAR(160) NOT NULL,
 type ENUM('Release','Meeting','Milestone','Other') NOT NULL,
 description TEXT NULL,
 location VARCHAR(2048) NOT NULL DEFAULT '',
 all_day BOOLEAN NOT NULL DEFAULT FALSE,
 start_at DATETIME(3) NULL COMMENT 'Timed events: UTC',
 end_at DATETIME(3) NULL COMMENT 'Timed events: UTC',
 start_date DATE NULL COMMENT 'All-day events: local calendar date',
 end_date DATE NULL COMMENT 'All-day events: inclusive local calendar date',
 timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Tokyo',
 cancelled BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id),
 CHECK ((all_day=TRUE AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date>=start_date AND start_at IS NULL AND end_at IS NULL) OR
        (all_day=FALSE AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at>start_at AND start_date IS NULL AND end_date IS NULL)),
 INDEX events_timed(project_id,start_at,end_at),
 INDEX events_dates(project_id,start_date,end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE event_attendees (
 event_id VARCHAR(64) NOT NULL,
 member_id VARCHAR(64) NOT NULL,
 PRIMARY KEY(event_id,member_id),
 FOREIGN KEY(event_id) REFERENCES events(id),
 FOREIGN KEY(member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE activity (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 project_id VARCHAR(64) NULL,
 actor VARCHAR(160) NOT NULL,
 action VARCHAR(64) NOT NULL,
 entity_type VARCHAR(64) NOT NULL,
 entity_id VARCHAR(64) NOT NULL,
 summary VARCHAR(500) NOT NULL,
 metadata JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(project_id) REFERENCES projects(id),
 INDEX activity_feed(project_id,created_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE schema_migrations (
 version VARCHAR(64) PRIMARY KEY,
 applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations(version) VALUES ('001_initial');
