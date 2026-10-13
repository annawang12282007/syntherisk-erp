ALTER TABLE accounts
 ADD COLUMN name_zh text,
 ADD COLUMN account_type text,
 ADD COLUMN normal_balance text CHECK (normal_balance IS NULL OR normal_balance IN ('Debit','Credit')),
 ADD COLUMN usage_status text;
