ALTER TABLE communication_templates
 ADD COLUMN body_format text NOT NULL DEFAULT 'plain' CHECK(body_format IN ('plain','formatted')),
 ADD COLUMN preheader text NOT NULL DEFAULT '',
 ADD COLUMN mail_header text NOT NULL DEFAULT '',
 ADD COLUMN mail_footer text NOT NULL DEFAULT '',
 ADD COLUMN mail_signature text NOT NULL DEFAULT '',
 ADD COLUMN accent_color text NOT NULL DEFAULT '#2e7c80';
ALTER TABLE google_mail_drafts
 ADD COLUMN body_format text NOT NULL DEFAULT 'plain' CHECK(body_format IN ('plain','formatted')),
 ADD COLUMN mail_style jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(mail_style)='object');
ALTER TABLE personal_mail_preferences ADD COLUMN signature_format text NOT NULL DEFAULT 'formatted' CHECK(signature_format IN ('plain','formatted'));
CREATE INDEX integration_mail_sent ON integration_items(connection_id,user_id,updated_at DESC) WHERE kind='gmail_message';

ALTER TABLE google_mail_drafts ADD COLUMN bcc_addresses text[] NOT NULL DEFAULT '{}';

ALTER TABLE communication_templates ADD CONSTRAINT communication_template_color CHECK(accent_color ~ '^#[0-9A-Fa-f]{6}$'), ADD CONSTRAINT communication_template_preheader CHECK(length(preheader)<=300), ADD CONSTRAINT communication_template_layout CHECK(length(mail_header)<=10000 AND length(mail_footer)<=10000 AND length(mail_signature)<=10000);
