-- Ticket editor: estimated time (hours) on a ticket, used by the editor's Time Tracking rail.
ALTER TABLE issues ADD COLUMN estimate_minutes INT UNSIGNED NULL;
