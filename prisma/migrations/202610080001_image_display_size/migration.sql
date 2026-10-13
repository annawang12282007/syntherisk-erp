-- Display sizing is independent of the original image and frozen in new receipts.
ALTER TABLE signature_profiles ADD COLUMN display_width integer NOT NULL DEFAULT 280 CHECK(display_width BETWEEN 60 AND 700);
ALTER TABLE signature_profile_versions ADD COLUMN display_width integer NOT NULL DEFAULT 280 CHECK(display_width BETWEEN 60 AND 700);
