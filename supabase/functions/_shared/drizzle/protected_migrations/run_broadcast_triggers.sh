#!/bin/bash

# Function to print usage
print_usage() {
    echo "Usage: $0 --db <postgres_url> --edge <edge_url> --key <service_key>"
    echo "Example: $0 \\"
    echo "  --db 'postgresql://user:pass@host:5432/dbname' \\"
    echo "  --edge 'https://your-edge-function-url' \\"
    echo "  --key 'your-service-key'"
    exit 1
}

# Parse named parameters
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --db) DB_URL="$2"; shift ;;
        --edge) EDGE_URL="$2"; shift ;;
        --key) SERVICE_KEY="$2"; shift ;;
        *) echo "Unknown parameter: $1"; print_usage ;;
    esac
    shift
done

# Verify all required parameters are provided
if [ -z "$DB_URL" ] || [ -z "$EDGE_URL" ] || [ -z "$SERVICE_KEY" ]; then
    echo "Error: Missing required parameters"
    print_usage
fi

# Create a temporary SQL file with substituted variables
TMP_SQL=$(mktemp)
sed "s|__EDGE_URL__|$EDGE_URL|g; s|__SERVICE_KEY__|$SERVICE_KEY|g" 0000_broadcast_triggers.sql > "$TMP_SQL"

# Run the SQL file
psql --dbname="$DB_URL" -f "$TMP_SQL"

# Clean up
rm "$TMP_SQL"

if [ $? -eq 0 ]; then
    echo "Migration completed successfully"
else
    echo "Error: Migration failed"
    exit 1
fi
