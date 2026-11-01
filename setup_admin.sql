-- IMPORTANT: Create your own admin account by signing up on the website first,
-- verify the email, then look up its UUID in Supabase > Authentication > Users.
-- Replace the example UUID below before running this statement in SQL Editor.
insert into public.admin_users(user_id) values ('00000000-0000-0000-0000-000000000000'::uuid)
on conflict (user_id) do nothing;
-- NEVER put a service_role key, database password, or private credentials into frontend files.
