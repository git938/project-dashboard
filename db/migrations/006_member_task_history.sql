CREATE TABLE IF NOT EXISTS member_task_history (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 member_id VARCHAR(64) NOT NULL,
 issue_id VARCHAR(64) NOT NULL,
 ticket_key VARCHAR(40) NOT NULL,
 task_name VARCHAR(160) NOT NULL,
 project_name VARCHAR(160) NOT NULL,
 kind VARCHAR(64) NOT NULL,
 status VARCHAR(32) NOT NULL,
 previous_status VARCHAR(32) NULL,
 event VARCHAR(32) NOT NULL,
 recorded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(member_id) REFERENCES members(id),
 FOREIGN KEY(issue_id) REFERENCES issues(id),
 INDEX member_history(member_id,recorded_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
