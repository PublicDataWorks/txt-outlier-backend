-- Add original message columns to broadcasts table to store messages before URL shortening
ALTER TABLE broadcasts ADD COLUMN original_first_message TEXT;
ALTER TABLE broadcasts ADD COLUMN original_second_message TEXT;

-- For existing data, populate the original_* columns with the same values as the message columns
UPDATE broadcasts SET original_first_message = first_message WHERE original_first_message IS NULL;
UPDATE broadcasts SET original_second_message = second_message WHERE original_second_message IS NULL;

-- Now that all data has been populated, set the columns to NOT NULL
ALTER TABLE broadcasts ALTER COLUMN original_first_message SET NOT NULL;
ALTER TABLE broadcasts ALTER COLUMN original_second_message SET NOT NULL;

-- Add comments explaining the purpose of the columns
COMMENT ON COLUMN broadcasts.original_first_message IS 'Stores the original first message before URL shortening';
COMMENT ON COLUMN broadcasts.original_second_message IS 'Stores the original second message before URL shortening';
