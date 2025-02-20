INSERT INTO "public"."audience_segments" ("id", "created_at", "query", "description", "name")
VALUES ('1', '2024-02-06 08:04:42.718926+00', 'SELECT a.phone_number FROM public.authors a ORDER BY random()',
        ' Query for testing', 'Test');
INSERT INTO "public"."audience_segments" ("id", "created_at", "query", "description", "name")
VALUES ('2', '2024-03-04 10:49:29.437967+00', 'SELECT a.phone_number FROM public.authors a ORDER BY RANDOM()',
        '50% everyone else (excluding unsubscribed users)', 'Inactive');
INSERT INTO "public"."broadcasts" ("id", "delay", "updated_at", "editable", "no_users",
                                   "first_message", "second_message", "twilio_paging")
VALUES ('473', 600, null, 'true', '10',
        'Test first message', 'Test second message', null);
INSERT INTO "public"."authors" ("created_at", "updated_at", "name", "phone_number", "unsubscribed")
VALUES ('2024-03-12 08:47:53.568392+00', null, 'People 1', '+13126185863', 'false');
INSERT INTO "public"."authors" ("created_at", "updated_at", "name", "phone_number", "unsubscribed")
VALUES ('2024-03-12 08:47:53.568392+00', null, 'People 2', '+14156694691', 'false');
INSERT INTO "public"."broadcasts_segments" ("broadcast_id", "segment_id", "ratio", "first_message", "second_message")
VALUES ('473', '1', '100', null, null);
INSERT INTO broadcast_settings (mon, tue, wed, thu, fri, sat, sun, active)
VALUES ('09:00:00', '09:00:00', '09:00:00', '09:00:00', null, null, null, true),
       (null, '12:30:00', '12:30:00', null, '12:30:00', null, null, false);

