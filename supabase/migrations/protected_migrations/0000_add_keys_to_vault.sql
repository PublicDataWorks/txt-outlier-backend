-- 0000_add_keys_to_vault.sql
DO $$
BEGIN
    -- Check if secrets already exist
    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'secret_key'
    ) THEN
        PERFORM vault.create_secret('{{SECRET_KEY}}', 'secret_key');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'edge_function_url'
    ) THEN
        PERFORM vault.create_secret('{{EDGE_URL}}', 'edge_function_url');
    END IF;
END $$;
