#!/bin/bash

# Function to print usage
print_usage() {
    echo "Usage: $0 --db <postgres_url> --key <service_role_key> --edge <edge_url>"
    echo "Or: $0 --env-file <path-to-env-file>"
    echo "Example: $0 \\"
    echo "  --db 'postgresql://user:pass@host:5432/dbname' \\"
    echo "  --key 'your-service-key' \\"
    echo "  --edge 'your-edge-url'"
    exit 1
}

# Parse named parameters
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --env-file)
            if [ -f "$2" ]; then
                source "$2"
            else
                echo "Error: Env file $2 not found"
                exit 1
            fi
            shift
            ;;
        --db) SUPABASE_DB_URL="$2"; shift ;;
        --key) SERVICE_ROLE_KEY="$2"; shift ;;
        --edge) EDGE_URL="$2"; shift ;;
        *) echo "Unknown parameter: $1"; print_usage ;;
    esac
    shift
done

# Verify all required parameters are provided
if [ -z "$SUPABASE_DB_URL" ] || [ -z "$SERVICE_ROLE_KEY" ] || [ -z "$EDGE_URL" ]; then
    echo "Error: Missing required parameters"
    print_usage
fi

# Create a temporary SQL file with substituted variables
TMP_SQL=$(mktemp)
cat ./0000_add_keys_to_vault.sql | \
    sed "s|{{SERVICE_ROLE_KEY}}|${SERVICE_ROLE_KEY}|g" | \
    sed "s|{{EDGE_URL}}|${EDGE_URL}|g" \
    > "$TMP_SQL"

# Run the SQL file
psql "$SUPABASE_DB_URL" -f "$TMP_SQL"

# Clean up
rm "$TMP_SQL"
