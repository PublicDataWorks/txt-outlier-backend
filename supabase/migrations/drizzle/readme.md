deno task dev
http://localhost:54323/project/default/integrations -> enable cron and queue
psql DB_URL -f 0000_oval_ricochet.sql
psql DB_URL -f 0001_true_naoko.sql

psql DB_URL seed_data.sql
create 2 queues: broadcast_first_messages and broadcast_second_messages

cd protected_migrations
./run_broadcast_triggers.sh
--db postgresql://postgres:postgres@127.0.0.1:54322/postgres
--edge http://kong:8000/functions/v1/
--key <key>

