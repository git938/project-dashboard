-- Demo fixtures only. Safe to rerun: existing records are not overwritten.

USE projects;

SET NAMES utf8mb4;

SET @demo_day = UTC_DATE();

START TRANSACTION;

INSERT INTO members (id,name,role,email) VALUES
('m-kl','Kiara Laras','Product designer','m-kl@example.test'),
('m-jt','Joe Tesla','Engineering lead','m-jt@example.test'),
('m-tb','Tania Brooks','Project manager','m-tb@example.test'),
('m-cw','Cameron Williamson','Product lead','m-cw@example.test'),
('m-bl','Bin Li','Workspace owner','m-bl@example.test'),
('m-ac','Alex Chen','QA engineer','m-ac@example.test'),
('m-ms','Maya Singh','Backend engineer','m-ms@example.test'),
('m-ys','Yuki Sato','Customer success','m-ys@example.test')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO teams (id,name,description) VALUES
('team-product','Product & Design','Research and product experience'),
('team-engineering','Engineering','Build and ship software'),
('team-success','Customer Success','Onboarding and customer support')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO team_members (team_id,member_id) VALUES
('team-product','m-kl'),
('team-product','m-tb'),
('team-product','m-cw'),
('team-engineering','m-jt'),
('team-engineering','m-bl'),
('team-engineering','m-ac'),
('team-engineering','m-ms'),
('team-success','m-ys'),
('team-success','m-cw')
ON DUPLICATE KEY UPDATE team_id=team_id;

INSERT INTO projects (id,name,description,status,manager_id,team_id,start_date,end_date) VALUES
('REV-241','Revenue Insights Revamp','Revenue reporting and trend analysis','Active','m-tb','team-product',@demo_day + INTERVAL -12 DAY,@demo_day + INTERVAL 14 DAY),
('ONB-118','Enterprise Onboarding Flow','Account setup and welcome experience','Active','m-cw','team-engineering',@demo_day + INTERVAL -7 DAY,@demo_day + INTERVAL 21 DAY),
('MOB-301','Mobile Workspace','Responsive workspace for teams on the go','On hold','m-kl','team-product',@demo_day + INTERVAL 0 DAY,@demo_day + INTERVAL 35 DAY),
('REL-090','September Maintenance Release','Completed reliability improvements','Completed','m-jt','team-engineering',@demo_day + INTERVAL -30 DAY,@demo_day + INTERVAL -2 DAY)
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO project_members (project_id,member_id) VALUES
('REV-241','m-tb'),
('REV-241','m-kl'),
('REV-241','m-ms'),
('ONB-118','m-cw'),
('ONB-118','m-jt'),
('ONB-118','m-ys'),
('ONB-118','m-ac'),
('MOB-301','m-kl'),
('MOB-301','m-bl'),
('MOB-301','m-ms'),
('REL-090','m-jt'),
('REL-090','m-ac'),
('REL-090','m-ms')
ON DUPLICATE KEY UPDATE project_id=project_id;

INSERT INTO issues (id,project_id,name,description,phase,status,assignee_id,start_date,end_date,sort_order) VALUES
('REV-TASK-101','REV-241','Interview stakeholders','Demo task for Revenue Insights Revamp','Discovery','Done','m-kl',@demo_day + INTERVAL -10 DAY,@demo_day + INTERVAL -7 DAY,0),
('REV-TASK-102','REV-241','Map the user journey','Demo task for Revenue Insights Revamp','Discovery','Done','m-jt',@demo_day + INTERVAL -7 DAY,@demo_day + INTERVAL -4 DAY,1),
('REV-TASK-103','REV-241','Review interface designs','Demo task for Revenue Insights Revamp','Design','Review','m-tb',@demo_day + INTERVAL -4 DAY,@demo_day + INTERVAL -1 DAY,2),
('REV-TASK-104','REV-241','Build core workflows','Demo task for Revenue Insights Revamp','Development','In Progress','m-cw',@demo_day + INTERVAL -1 DAY,@demo_day + INTERVAL 2 DAY,3),
('REV-TASK-105','REV-241','Test edge cases','Demo task for Revenue Insights Revamp','Development','Todo','m-bl',@demo_day + INTERVAL 2 DAY,@demo_day + INTERVAL 5 DAY,4),
('REV-TASK-106','REV-241','Prepare release checklist','Demo task for Revenue Insights Revamp','Launch','Backlog','m-ac',@demo_day + INTERVAL 5 DAY,@demo_day + INTERVAL 8 DAY,5),
('ONB-TASK-101','ONB-118','Interview stakeholders','Demo task for Enterprise Onboarding Flow','Discovery','Done','m-jt',@demo_day + INTERVAL -10 DAY,@demo_day + INTERVAL -7 DAY,0),
('ONB-TASK-102','ONB-118','Map the user journey','Demo task for Enterprise Onboarding Flow','Discovery','Done','m-tb',@demo_day + INTERVAL -7 DAY,@demo_day + INTERVAL -4 DAY,1),
('ONB-TASK-103','ONB-118','Review interface designs','Demo task for Enterprise Onboarding Flow','Design','Review','m-cw',@demo_day + INTERVAL -4 DAY,@demo_day + INTERVAL -1 DAY,2),
('ONB-TASK-104','ONB-118','Build core workflows','Demo task for Enterprise Onboarding Flow','Development','In Progress','m-bl',@demo_day + INTERVAL -1 DAY,@demo_day + INTERVAL 2 DAY,3),
('ONB-TASK-105','ONB-118','Test edge cases','Demo task for Enterprise Onboarding Flow','Development','Todo','m-ac',@demo_day + INTERVAL 2 DAY,@demo_day + INTERVAL 5 DAY,4),
('ONB-TASK-106','ONB-118','Prepare release checklist','Demo task for Enterprise Onboarding Flow','Launch','Backlog','m-ms',@demo_day + INTERVAL 5 DAY,@demo_day + INTERVAL 8 DAY,5),
('MOB-TASK-101','MOB-301','Interview stakeholders','Demo task for Mobile Workspace','Discovery','Done','m-tb',@demo_day + INTERVAL -10 DAY,@demo_day + INTERVAL -7 DAY,0),
('MOB-TASK-102','MOB-301','Map the user journey','Demo task for Mobile Workspace','Discovery','Done','m-cw',@demo_day + INTERVAL -7 DAY,@demo_day + INTERVAL -4 DAY,1),
('MOB-TASK-103','MOB-301','Review interface designs','Demo task for Mobile Workspace','Design','Review','m-bl',@demo_day + INTERVAL -4 DAY,@demo_day + INTERVAL -1 DAY,2),
('MOB-TASK-104','MOB-301','Build core workflows','Demo task for Mobile Workspace','Development','In Progress','m-ac',@demo_day + INTERVAL -1 DAY,@demo_day + INTERVAL 2 DAY,3),
('MOB-TASK-105','MOB-301','Test edge cases','Demo task for Mobile Workspace','Development','Todo','m-ms',@demo_day + INTERVAL 2 DAY,@demo_day + INTERVAL 5 DAY,4),
('MOB-TASK-106','MOB-301','Prepare release checklist','Demo task for Mobile Workspace','Launch','Backlog','m-ys',@demo_day + INTERVAL 5 DAY,@demo_day + INTERVAL 8 DAY,5),
('REL-TASK-101','REL-090','Interview stakeholders','Demo task for September Maintenance Release','Discovery','Done','m-cw',@demo_day + INTERVAL -28 DAY,@demo_day + INTERVAL -26 DAY,0),
('REL-TASK-102','REL-090','Map the user journey','Demo task for September Maintenance Release','Discovery','Done','m-bl',@demo_day + INTERVAL -25 DAY,@demo_day + INTERVAL -23 DAY,1),
('REL-TASK-103','REL-090','Review interface designs','Demo task for September Maintenance Release','Design','Done','m-ac',@demo_day + INTERVAL -22 DAY,@demo_day + INTERVAL -20 DAY,2),
('REL-TASK-104','REL-090','Build core workflows','Demo task for September Maintenance Release','Development','Done','m-ms',@demo_day + INTERVAL -19 DAY,@demo_day + INTERVAL -17 DAY,3),
('REL-TASK-105','REL-090','Test edge cases','Demo task for September Maintenance Release','Development','Done','m-ys',@demo_day + INTERVAL -16 DAY,@demo_day + INTERVAL -14 DAY,4),
('REL-TASK-106','REL-090','Prepare release checklist','Demo task for September Maintenance Release','Launch','Done','m-kl',@demo_day + INTERVAL -13 DAY,@demo_day + INTERVAL -11 DAY,5)
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO milestones (id,project_id,name,date,status) VALUES
('ms-1','REV-241','Design sign-off',@demo_day + INTERVAL 2 DAY,'Planned'),
('ms-2','REV-241','Dashboard release',@demo_day + INTERVAL 14 DAY,'Planned'),
('ms-3','ONB-118','Pilot launch',@demo_day + INTERVAL 7 DAY,'Planned'),
('ms-4','ONB-118','General availability',@demo_day + INTERVAL 21 DAY,'Planned'),
('ms-5','MOB-301','Mobile prototype review',@demo_day + INTERVAL 12 DAY,'Planned'),
('ms-6','REL-090','Maintenance deployed',@demo_day + INTERVAL -2 DAY,'Completed')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO notes (id,project_id,owner_id,name,content,tag) VALUES
('note-1','REV-241','m-tb','Revenue review owners','Confirm reporting definitions with the finance team.','Review'),
('note-2','ONB-118','m-cw','Pilot feedback','Collect setup feedback from the first five pilot users.','Pilot'),
('note-3','MOB-301','m-kl','Mobile constraints','Support narrow screens and touch targets.','Design'),
('note-4',NULL,'m-bl','Weekly planning','Review open blockers every Monday.','Workspace'),
('note-5','REL-090','m-ac','Release retrospective','All acceptance checks passed. Monitor the next release.','Done')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO documents (id,project_id,name,category,kind,content,original_name,storage_key,mime_type,size_bytes) VALUES
('doc-1','REV-241','Revenue dashboard brief','Brief','note','Goal: make revenue trends and exceptions easy to understand.',NULL,NULL,NULL,NULL),
('doc-2','ONB-118','Onboarding specification','Specification','note','Steps: create account, invite team, configure workspace.',NULL,NULL,NULL,NULL),
('doc-3','MOB-301','Mobile design notes','Design','note','Use a compact navigation and accessible controls.',NULL,NULL,NULL,NULL),
('doc-4','REV-241','Release checklist','Release','file',NULL,'release-checklist.txt','demo/release-checklist.txt','text/plain',114)
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO events (id,project_id,title,type,all_day,start_at,end_at,start_date,end_date,timezone,location) VALUES
('ev-1','REV-241','Revenue design review','Meeting',False,@demo_day + INTERVAL 1 DAY + INTERVAL 1 HOUR,@demo_day + INTERVAL 1 DAY + INTERVAL 2 HOUR,NULL,NULL,'Asia/Tokyo','Demo meeting room'),
('ev-2','REV-241','Revenue release','Release',True,NULL,NULL,@demo_day + INTERVAL 14 DAY,@demo_day + INTERVAL 14 DAY,'Asia/Tokyo','Demo meeting room'),
('ev-3','ONB-118','Pilot kickoff','Meeting',False,@demo_day + INTERVAL 3 DAY + INTERVAL 1 HOUR,@demo_day + INTERVAL 3 DAY + INTERVAL 2 HOUR,NULL,NULL,'Asia/Tokyo','Demo meeting room'),
('ev-4','ONB-118','Onboarding release','Release',True,NULL,NULL,@demo_day + INTERVAL 21 DAY,@demo_day + INTERVAL 21 DAY,'Asia/Tokyo','Demo meeting room'),
('ev-5','MOB-301','Prototype milestone','Milestone',True,NULL,NULL,@demo_day + INTERVAL 12 DAY,@demo_day + INTERVAL 12 DAY,'Asia/Tokyo','Demo meeting room'),
('ev-6','REL-090','Release retrospective','Other',False,@demo_day + INTERVAL 0 DAY + INTERVAL 1 HOUR,@demo_day + INTERVAL 0 DAY + INTERVAL 2 HOUR,NULL,NULL,'Asia/Tokyo','Demo meeting room')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO event_attendees (event_id,member_id) VALUES
('ev-1','m-kl'),
('ev-1','m-tb'),
('ev-2','m-kl'),
('ev-2','m-tb'),
('ev-3','m-kl'),
('ev-3','m-tb'),
('ev-4','m-kl'),
('ev-4','m-tb'),
('ev-5','m-kl'),
('ev-5','m-tb'),
('ev-6','m-kl'),
('ev-6','m-tb')
ON DUPLICATE KEY UPDATE event_id=event_id;

INSERT INTO activity (id,project_id,actor,action,entity_type,entity_id,summary) VALUES
(900001,'REV-241','demo-seed','created','project','REV-241','Demo project created: Revenue Insights Revamp'),
(900002,'ONB-118','demo-seed','created','project','ONB-118','Demo project created: Enterprise Onboarding Flow'),
(900003,'MOB-301','demo-seed','created','project','MOB-301','Demo project created: Mobile Workspace'),
(900004,'REL-090','demo-seed','created','project','REL-090','Demo project created: September Maintenance Release')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO schema_migrations (version) VALUES
('001_initial')
ON DUPLICATE KEY UPDATE version=version;

COMMIT;
