const runBroadcastCron = (timeStamp: Date): string => {
  const date = new Date(timeStamp);
  const runTime = dateToCron(date);
  return `
        select
        cron.schedule(
            'invoke-broadcast',
            '${runTime}',
        $$
        select
        net.http_get(
            url:='${Deno.env.get("BACKEND_URL")!}/broadcast/make',
            headers:='{"Content-Type": "application/json", "Authorization": "Bearer ${Deno
            .env.get("SUPABASE_SERVICE_ROLE_KEY")!}"}'::jsonb
        ) as request_id;
        $$
        );
    `;
};

const createSendingFirstMessageCron = (id: number) => {
  return `
        select
        cron.schedule(
            'send-first',
            '* * * * *',
        $$
        select
        net.http_get(
            url:='${Deno.env.get("BACKEND_URL")!}/broadcasts/draft/${id}',
            headers:='{"Content-Type": "application/json", "Authorization": "Bearer ${Deno
      .env.get("SUPABASE_SERVICE_ROLE_KEY")!}"}'::jsonb
        ) as request_id;
        $$
        );
    `;
};

const createSendingSecondMessageCron = (timeStamp: Date, id: number) => {
  const date = new Date(timeStamp);
  const newDate = new Date(date.getTime() + 5 * 60 * 1000);
  const runTime = dateToCron(newDate);

  return `
        select
          cron.schedule(
            'invoke-function',
            '${runTime}',
            $$
              DELETE FROM outgoing_messages o
                WHERE
                  o.broadcast_id = ${id}
                  AND o.is_second = true
                  AND o.recipient_phone_number IN (
                    SELECT t.from_field
                    FROM twilio_messages t
                    WHERE t.delivered_at >= '${date.toISOString()}' AND t.delivered_at <= now()
                  );
              select 
                cron.schedule(
                'send-second',
                '* * * * *', -- every minute
                'select
                  net.http_get(
                    url:=''${Deno.env.get("BACKEND_URL")!}/broadcasts/draft/${id}?isSecond=true'',
                    headers:=''{"Content-Type": "application/json", "Authorization": "Bearer ${Deno
                    .env.get("SUPABASE_SERVICE_ROLE_KEY")!}"}''::jsonb
                  ) as request_id'
              );
            $$
          );
    `;
};

export { createSendingFirstMessageCron, createSendingSecondMessageCron, runBroadcastCron };

const dateToCron = (date: Date) => {
  const minutes = date.getMinutes();
  const hours = date.getHours();
  const days = date.getDate();
  const months = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  return `${minutes} ${hours} ${days} ${months} ${dayOfWeek}`;
};
