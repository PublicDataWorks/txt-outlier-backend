ALTER TABLE campaigns
ADD COLUMN label_ids TEXT[] DEFAULT '{}';
