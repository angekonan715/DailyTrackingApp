-- Let the account owner choose the password when adding a family member.
-- Paste this whole script into the Supabase SQL editor and run it.

drop function if exists public.add_family_member(text, text);

create or replace function public.add_family_member(member_email text, member_name text, member_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  house uuid;
  found uuid;
  their_house uuid;
  their_count integer;
  clean_name text;
  clean_email text;
  my_email text;
begin
  if me is null then
    raise exception 'Sign in again.';
  end if;

  clean_email := lower(trim(coalesce(member_email, '')));
  clean_name := trim(coalesce(member_name, ''));
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a real email address.';
  end if;
  if clean_name = '' then
    clean_name := split_part(clean_email, '@', 1);
  end if;
  if length(clean_name) > 40 then
    clean_name := left(clean_name, 40);
  end if;
  if member_password is null or length(member_password) < 6 then
    raise exception 'Use at least 6 characters for their password.';
  end if;
  if length(member_password) > 72 then
    raise exception 'Use 72 characters or fewer for their password.';
  end if;

  select id into found from auth.users where lower(email) = clean_email limit 1;
  if found = me then
    raise exception 'That is your own email.';
  end if;

  if found is null then
    found := gen_random_uuid();
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      email_change_token_current
    ) values (
      '00000000-0000-0000-0000-000000000000',
      found,
      'authenticated',
      'authenticated',
      clean_email,
      extensions.crypt(member_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', clean_name),
      now(),
      now(),
      '',
      '',
      '',
      '',
      ''
    );
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      found,
      found::text,
      jsonb_build_object('sub', found::text, 'email', clean_email, 'email_verified', true),
      'email',
      now(),
      now(),
      now()
    );
  else
    update auth.users
      set encrypted_password = extensions.crypt(member_password, extensions.gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = found;
  end if;

  select household_id into house from public.household_members where user_id = me;
  if house is null then
    my_email := coalesce(auth.jwt() ->> 'email', '');
    insert into public.households (created_by) values (me) returning id into house;
    insert into public.household_members (household_id, user_id, display_name, email)
    values (house, me, split_part(my_email, '@', 1), my_email);
  end if;

  select household_id into their_house from public.household_members where user_id = found;
  if their_house = house then
    update public.household_members
      set display_name = clean_name
      where user_id = found;
    return jsonb_build_object('user_id', found, 'display_name', clean_name, 'email', clean_email, 'share_summary', false);
  end if;

  if (select count(*) from public.household_members where household_id = house) >= 8 then
    raise exception 'This family already has 8 people.';
  end if;

  if their_house is not null then
    select count(*) into their_count from public.household_members where household_id = their_house;
    if their_count > 1 then
      raise exception 'They already share with another family.';
    end if;
    delete from public.household_members where user_id = found;
    delete from public.households where id = their_house;
  end if;

  insert into public.household_members (household_id, user_id, display_name, email)
  values (house, found, clean_name, clean_email);

  return jsonb_build_object('user_id', found, 'display_name', clean_name, 'email', clean_email, 'share_summary', false);
end;
$$;

revoke all on function public.add_family_member(text, text, text) from public;
grant execute on function public.add_family_member(text, text, text) to authenticated;
