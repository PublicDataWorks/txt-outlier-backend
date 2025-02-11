create table broadcast_schedules
(
  id         bigint primary key generated always as identity not null,
  mon        time null,
  tue        time null,
  wed        time null,
  thu        time null,
  fri        time null,
  sat        time null,
  sun        time null,
  active     boolean     default true not null,
  created_at timestamptz default now() null,
  updated_at timestamptz default now() not null
);
