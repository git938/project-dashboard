CREATE TABLE IF NOT EXISTS comments (
 id VARCHAR(64) PRIMARY KEY,
 issue_id VARCHAR(64) NOT NULL,
 author_id VARCHAR(64) NULL,
 body TEXT NOT NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(issue_id) REFERENCES issues(id),
 FOREIGN KEY(author_id) REFERENCES members(id),
 INDEX comments_issue(issue_id,created_at),
 INDEX comments_author(author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS labels (
 id VARCHAR(64) PRIMARY KEY,
 name VARCHAR(64) NOT NULL,
 color CHAR(7) NOT NULL DEFAULT '#6366f1',
 version INT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 UNIQUE KEY labels_name(name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS issue_labels (
 issue_id VARCHAR(64) NOT NULL,
 label_id VARCHAR(64) NOT NULL,
 PRIMARY KEY(issue_id,label_id),
 FOREIGN KEY(issue_id) REFERENCES issues(id),
 FOREIGN KEY(label_id) REFERENCES labels(id),
 INDEX issue_labels_label(label_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_entries (
 id VARCHAR(64) PRIMARY KEY,
 issue_id VARCHAR(64) NOT NULL,
 member_id VARCHAR(64) NULL,
 minutes INT NOT NULL,
 spent_on DATE NOT NULL,
 note VARCHAR(500) NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(issue_id) REFERENCES issues(id),
 FOREIGN KEY(member_id) REFERENCES members(id),
 CHECK(minutes > 0),
 INDEX time_entries_issue(issue_id,spent_on),
 INDEX time_entries_member(member_id,spent_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS issue_links (
 id VARCHAR(64) PRIMARY KEY,
 from_issue_id VARCHAR(64) NOT NULL,
 to_issue_id VARCHAR(64) NOT NULL,
 kind ENUM('parent','related') NOT NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 FOREIGN KEY(from_issue_id) REFERENCES issues(id),
 FOREIGN KEY(to_issue_id) REFERENCES issues(id),
 CHECK(from_issue_id <> to_issue_id),
 UNIQUE KEY issue_links_edge(from_issue_id,to_issue_id,kind),
 INDEX issue_links_to(to_issue_id,kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
