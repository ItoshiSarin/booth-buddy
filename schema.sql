-- BOOTH BUDDY | PostgreSQL schema for a NEW Supabase project.
-- Run once in the Supabase SQL editor, then run setup_admin.sql separately.
-- Designed to deny direct writes to bookings and enforce stall capacity in transactional RPCs.
create extension if not exists pgcrypto;
create schema if not exists private;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create table public.merchant_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  brand_name text not null check(length(trim(brand_name)) between 2 and 100),
  owner_name text not null check(length(trim(owner_name)) between 2 and 100),
  phone text not null check(length(phone) between 8 and 24),
  social text not null default '',
  bio text not null default '',
  category text not null check(category in ('beverage','food','food_beverage','fashion','general','footwear','jewelry','beauty','fragrance','crafts','tech','pets','other')),
  product_list text not null default '',
  product_tags text[] not null default '{}'::text[],
  space_units integer not null default 1 check (space_units in (1,2)),
  needs_power boolean not null default false,
  needs_water boolean not null default false,
  uses_heat boolean not null default false,
  strong_scent boolean not null default false,
  doc_path text,
  doc_type text not null default 'Valid ID',
  promo_paths text[] not null default '{}'::text[],
  promo_consent boolean not null default false,
  verification_status text not null default 'pending' check(verification_status in ('pending','verified','rejected')),
  verification_note text,
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  venue text not null,
  description text not null default '',
  image_url text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  published boolean not null default false,
  status text not null default 'open' check (status in ('open','paused','cancelled')),
  solo_price integer not null check(solo_price>=0),
  shared_price integer not null check(shared_price>=0),
  power_available boolean not null default true,
  water_available boolean not null default false,
  heat_allowed boolean not null default false,
  scent_allowed boolean not null default true,
  created_at timestamptz not null default now(),
  check(ends_at>starts_at)
);

create table public.stalls (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  code text not null check(length(trim(code)) between 1 and 30),
  mode text not null check(mode in ('solo','shared')),
  has_power boolean not null default false,
  enabled boolean not null default true,
  notes text not null default '',
  unique(event_id,code)
);

create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  specs text not null default '',
  image_url text not null default '',
  price integer not null check(price>=0),
  total_stock integer not null default 0 check(total_stock>=0),
  one_per_stall boolean not null default false,
  enabled boolean not null default true
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  payee text not null,
  instructions text not null,
  qr_image_url text not null default '',
  enabled boolean not null default false
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profiles(user_id),
  event_id uuid not null references public.events(id),
  stall_id uuid not null references public.stalls(id),
  mode text not null check(mode in ('solo','shared')),
  declared_products text not null check(length(trim(declared_products)) >= 5),
  product_tags_snapshot text[] not null,
  category_snapshot text not null,
  status text not null default 'pending_payment' check(status in ('pending_payment','pending_review','approved','declined','cancelled','expired')),
  needs_match_review boolean not null default false,
  payment_status text not null default 'not_submitted' check(payment_status in ('not_submitted','reported','verified','refund_due','refunded')),
  payment_method_id uuid references public.payment_methods(id),
  payment_reference text,
  proof_path text,
  total_amount integer not null check(total_amount >= 0),
  reservation_expires_at timestamptz,
  review_note text,
  approved_at timestamptz,
  checked_in_at timestamptz,
  refunded_at timestamptz,
  refund_reference text,
  created_at timestamptz not null default now()
);
create index bookings_stall_active_idx on public.bookings(stall_id,status);
create index bookings_merchant_idx on public.bookings(merchant_id,event_id);

create table public.booking_supplies (
  booking_id uuid not null references public.bookings(id) on delete restrict,
  supply_id uuid not null references public.supplies(id) on delete restrict,
  qty integer not null check(qty between 1 and 5),
  unit_price integer not null check(unit_price>=0),
  primary key(booking_id,supply_id)
);

-- Canonical product tags ensure case/whitespace cannot bypass exact-tag conflict checks.
create function private.normalize_merchant_tags() returns trigger language plpgsql set search_path = '' as $$
begin
 select coalesce(array(select distinct lower(btrim(t.tag)) from unnest(new.product_tags) as t(tag)
   where length(btrim(t.tag)) between 2 and 64 order by 1),array[]::text[]) into new.product_tags;
 if cardinality(new.product_tags)>30 then raise exception 'Use 30 product tags or fewer';end if;
 return new;
end $$;
create trigger a_normalize_merchant_tags before insert or update on public.merchant_profiles
for each row execute function private.normalize_merchant_tags();

-- Prevent users changing details that existing bookings depend upon.
create function private.guard_merchant_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id <> old.user_id then raise exception 'Cannot change account ownership'; end if;
  if new.doc_path is not null and split_part(new.doc_path,'/',1) <> new.user_id::text then
    raise exception 'Document must be in your own storage folder';
  end if;
  if (new.brand_name,new.owner_name,new.product_list,new.category,new.product_tags,new.space_units,new.needs_power,new.needs_water,new.uses_heat,new.strong_scent)
     is distinct from (old.brand_name,old.owner_name,old.product_list,old.category,old.product_tags,old.space_units,old.needs_power,old.needs_water,old.uses_heat,old.strong_scent)
  then
    if exists(select 1 from public.bookings b join public.events e on e.id=b.event_id
      where b.merchant_id=new.user_id and b.status in ('pending_payment','pending_review','approved')
      and e.ends_at>now() and (b.status <> 'pending_payment' or b.reservation_expires_at>now())) then
      raise exception 'Cancel active reservations before changing products, category, or setup requirements';
    end if;
    new.verification_status := 'pending';
    new.verification_note := null;
  end if;
  if new.doc_path is distinct from old.doc_path then
    if exists(select 1 from public.bookings b join public.events e on e.id=b.event_id
      where b.merchant_id=new.user_id and b.status='approved' and e.ends_at>now()) then
      raise exception 'Contact the organizer before replacing documents on an approved booking';
    end if;
    new.verification_status := 'pending';
    new.verification_note := null;
  end if;
  new.updated_at := now();
  return new;
end; $$;
create trigger merchant_profile_guard before update on public.merchant_profiles
for each row execute function private.guard_merchant_profile();

-- Lock contractual prices/dates once a real booking is placed.
create function private.guard_event_contract() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if (new.starts_at,new.ends_at,new.solo_price,new.shared_price)
    is distinct from (old.starts_at,old.ends_at,old.solo_price,old.shared_price)
    and exists(select 1 from public.bookings where event_id=old.id and status in ('pending_payment','pending_review','approved')) then
    raise exception 'Event dates/prices are locked while reservations exist';
 end if;
 return new;
end $$;
create trigger guard_event_contract before update on public.events
for each row execute function private.guard_event_contract();

-- Immutable booking/verification audit history. Only admins can inspect it.
create table public.audit_log (
 id bigint generated always as identity primary key,
 actor_user_id uuid,
 entity_type text not null,
 entity_id uuid not null,
 old_status text,
 new_status text,
 note text,
 happened_at timestamptz not null default now()
);
create function private.track_status_changes() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_table_name='bookings' then
   if (new.status,new.payment_status,new.checked_in_at) is distinct from (old.status,old.payment_status,old.checked_in_at) then
     insert into public.audit_log(actor_user_id,entity_type,entity_id,old_status,new_status,note)
       values(auth.uid(),'booking',new.id,old.status||' / '||old.payment_status,new.status||' / '||new.payment_status,new.review_note);
   end if;
 elsif tg_table_name='merchant_profiles' then
   if new.verification_status is distinct from old.verification_status then
     insert into public.audit_log(actor_user_id,entity_type,entity_id,old_status,new_status,note)
       values(auth.uid(),'merchant',new.user_id,old.verification_status,new.verification_status,new.verification_note);
   end if;
 end if;
 return new;
end $$;
create trigger track_booking_status after update on public.bookings for each row execute function private.track_status_changes();
create trigger track_merchant_status after update on public.merchant_profiles for each row execute function private.track_status_changes();
alter table public.audit_log enable row level security;
create policy "admin audit only" on public.audit_log for select to authenticated using((select private.is_admin()));
revoke all on public.audit_log from anon,authenticated;
grant select on public.audit_log to authenticated;

-- Private file storage (object keys always begin with the authenticated user's UUID).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('merchant-docs','merchant-docs',false,10485760,array['image/png','image/jpeg','image/webp','application/pdf']),
 ('payment-proofs','payment-proofs',false,10485760,array['image/png','image/jpeg','image/webp','application/pdf']),
 ('promo-images','promo-images',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;

create function private.owns_object(path text) returns boolean language sql stable set search_path = '' as $$
  select split_part(path,'/',1)=auth.uid()::text;
$$;
revoke all on function private.owns_object(text) from public,anon;
grant execute on function private.owns_object(text) to authenticated;

create policy "bb storage insert own" on storage.objects for insert to authenticated
with check(bucket_id in ('merchant-docs','payment-proofs','promo-images') and private.owns_object(name));
create policy "bb storage read own or admin" on storage.objects for select to authenticated
using(bucket_id in ('merchant-docs','payment-proofs','promo-images') and (private.owns_object(name) or (select private.is_admin())));

-- RLS: direct booking mutations are deliberately not permitted to browser clients.
alter table public.admin_users enable row level security;
alter table public.merchant_profiles enable row level security;
alter table public.events enable row level security;
alter table public.stalls enable row level security;
alter table public.supplies enable row level security;
alter table public.payment_methods enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_supplies enable row level security;
create policy "admin lookup self" on public.admin_users for select to authenticated using(user_id=auth.uid());
create policy "profile self or admin view" on public.merchant_profiles for select to authenticated using(user_id=auth.uid() or (select private.is_admin()));
create policy "profile self create" on public.merchant_profiles for insert to authenticated with check(user_id=auth.uid() and verification_status='pending' and doc_path like auth.uid()::text || '/%');
create policy "profile self update" on public.merchant_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "anon published events" on public.events for select to anon using(published and status <> 'cancelled');
create policy "authenticated events" on public.events for select to authenticated using((published and status <> 'cancelled') or (select private.is_admin()));
create policy "admin events insert" on public.events for insert to authenticated with check((select private.is_admin()));
create policy "admin events update" on public.events for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
create policy "admin events delete" on public.events for delete to authenticated using((select private.is_admin()));
create policy "anon published stalls" on public.stalls for select to anon using(exists(select 1 from public.events e where e.id=event_id and e.published and e.status <> 'cancelled'));
create policy "authenticated stalls" on public.stalls for select to authenticated using(exists(select 1 from public.events e where e.id=event_id and e.published and e.status <> 'cancelled') or (select private.is_admin()));
create policy "admin stalls insert" on public.stalls for insert to authenticated with check((select private.is_admin()));
create policy "admin stalls update" on public.stalls for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
create policy "admin stalls delete" on public.stalls for delete to authenticated using((select private.is_admin()));
create policy "anon enabled supplies" on public.supplies for select to anon using(enabled);
create policy "authenticated supplies" on public.supplies for select to authenticated using(enabled or (select private.is_admin()));
create policy "admin supplies insert" on public.supplies for insert to authenticated with check((select private.is_admin()));
create policy "admin supplies update" on public.supplies for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
create policy "payment methods readable" on public.payment_methods for select to authenticated using(enabled or (select private.is_admin()));
create policy "admin payment methods insert" on public.payment_methods for insert to authenticated with check((select private.is_admin()));
create policy "admin payment methods update" on public.payment_methods for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
create policy "bookings only own or admin" on public.bookings for select to authenticated using(merchant_id=auth.uid() or (select private.is_admin()));
create policy "supply lines only own or admin" on public.booking_supplies for select to authenticated using(exists(select 1 from public.bookings b where b.id=booking_id and (b.merchant_id=auth.uid() or (select private.is_admin()))));

revoke all on public.admin_users,public.merchant_profiles,public.events,public.stalls,public.supplies,public.payment_methods,public.bookings,public.booking_supplies from anon,authenticated;
grant select on public.events,public.stalls,public.supplies to anon;
grant select on public.admin_users,public.merchant_profiles,public.events,public.stalls,public.supplies,public.payment_methods,public.bookings,public.booking_supplies to authenticated;
grant insert(user_id,brand_name,owner_name,phone,social,bio,category,product_list,product_tags,space_units,needs_power,needs_water,uses_heat,strong_scent,doc_path,doc_type,promo_paths,promo_consent) on public.merchant_profiles to authenticated;
grant update(brand_name,owner_name,phone,social,bio,category,product_list,product_tags,space_units,needs_power,needs_water,uses_heat,strong_scent,doc_path,doc_type,promo_paths,promo_consent) on public.merchant_profiles to authenticated;
grant insert,update,delete on public.events,public.stalls,public.supplies,public.payment_methods to authenticated;

-- Conservative auto-approved category pairs; any other distinct-category pair requires review.
create function public.is_auto_pair(a text,b text) returns boolean language sql immutable set search_path = '' as $$
  select (a='beverage' and b='food') or (a='food' and b='beverage') or
  (a='fashion' and b in ('footwear','jewelry','beauty')) or
  (b='fashion' and a in ('footwear','jewelry','beauty')) or
  (a='footwear' and b='jewelry') or (b='footwear' and a='jewelry') or
  (a='beauty' and b in ('jewelry','fragrance')) or
  (b='beauty' and a in ('jewelry','fragrance')) or
  (a='general' and b='crafts') or (a='crafts' and b='general');
$$;

-- Live, consistent stall options. Display only approved first merchants, never fake brands.
create function public.get_stall_options(p_event_id uuid)
returns table(stall_id uuid,code text,mode text,state text,partner_brand text,partner_category text,partner_bio text,reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_stall public.stalls%rowtype;
  v_me public.merchant_profiles%rowtype;
  v_count integer;
  v_first public.bookings%rowtype;
  v_partner public.merchant_profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into v_me from public.merchant_profiles where user_id=auth.uid();
  if not found then raise exception 'Complete your merchant profile first'; end if;
  if not exists(select 1 from public.events where id=p_event_id and published and status='open' and starts_at>now()) then
    raise exception 'Event is not open for reservations'; end if;
  for v_stall in select * from public.stalls s where s.event_id=p_event_id and s.enabled order by s.code loop
    select count(*) into v_count from public.bookings b where b.stall_id=v_stall.id and
      (b.status in ('approved','pending_review') or (b.status='pending_payment' and b.reservation_expires_at>now()));
    stall_id := v_stall.id; code := v_stall.code; mode := v_stall.mode;
    partner_brand := null;partner_category := null;partner_bio := null;reason := '';
    if (v_me.needs_power and not v_stall.has_power) then state:='blocked';reason:='Requires electricity; this stall has none';
    elsif v_me.space_units>1 and v_stall.mode='shared' then state:='blocked';reason:='Your setup needs a full booth';
    elsif v_stall.mode='solo' then
      state := case when v_count=0 then 'open_solo' else 'full' end;
    elsif v_count>=2 then state:='full';
    elsif v_count=0 then state:='open_shared';
    else
      select * into v_first from public.bookings b where b.stall_id=v_stall.id and
       (b.status in ('approved','pending_review') or (b.status='pending_payment' and b.reservation_expires_at>now())) limit 1;
      if v_first.merchant_id=auth.uid() then state:='yours';
      elsif v_first.status<>'approved' then state:='held';reason:='First merchant awaiting verification';
      else
        select * into v_partner from public.merchant_profiles where user_id=v_first.merchant_id;
        partner_brand := v_partner.brand_name;partner_category:=v_partner.category;partner_bio:=left(v_partner.bio,180);
        if v_me.category=v_partner.category then state:='blocked';reason:='Same category';
        elsif v_me.product_tags && v_first.product_tags_snapshot then state:='blocked';reason:='Overlapping product tags';
        elsif v_me.space_units+v_partner.space_units>2 then state:='blocked';reason:='Combined setups exceed booth size';
        elsif public.is_auto_pair(v_me.category,v_partner.category) then state:='compatible';reason:='Complementary categories; final admin review required';
        else state:='review';reason:='Organizer review needed for this category pairing';
        end if;
      end if;
    end if;
    return next;
  end loop;
end $$;

-- Atomically lock a physical stall, calculate prices and allocate optional dated equipment.
create function public.create_booking(p_event_id uuid,p_stall_id uuid,p_products text,p_supplies jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid:=auth.uid();v_profile public.merchant_profiles%rowtype;
 v_event public.events%rowtype;v_stall public.stalls%rowtype;
 v_other public.bookings%rowtype;v_other_profile public.merchant_profiles%rowtype;
 v_cnt integer;v_review boolean:=false;v_total integer;v_id uuid;
 v_item jsonb;v_supply public.supplies%rowtype;v_qty integer;v_used integer;v_same_stall integer;v_seen uuid[]:=array[]::uuid[];v_supply_id uuid;
begin
 if v_user is null then raise exception 'Please sign in';end if;
 if length(trim(coalesce(p_products,'')))<5 then raise exception 'Declare the products you will sell';end if;
 if length(p_products)>4000 then raise exception 'Product list is too long';end if;
 select * into v_profile from public.merchant_profiles where user_id=v_user;
 if not found or v_profile.doc_path is null or cardinality(v_profile.product_tags)=0 or v_profile.verification_status='rejected' then
   raise exception 'Complete your documents and product tags before booking';end if;
 if not exists(select 1 from storage.objects where bucket_id='merchant-docs' and name=v_profile.doc_path) then
   raise exception 'Uploaded verification document is missing';end if;
 select * into v_event from public.events where id=p_event_id;
 if not found or not v_event.published or v_event.status<>'open' or v_event.starts_at<=now() then raise exception 'Event is closed';end if;
 -- Lock serializes concurrent reservations of this particular physical stall.
 select * into v_stall from public.stalls where id=p_stall_id and event_id=p_event_id for update;
 if not found or not v_stall.enabled then raise exception 'Stall is unavailable';end if;
 if (v_profile.needs_power and (not v_event.power_available or not v_stall.has_power)) or
    (v_profile.needs_water and not v_event.water_available) or
    (v_profile.uses_heat and not v_event.heat_allowed) or
    (v_profile.strong_scent and not v_event.scent_allowed) or
    (v_profile.space_units>1 and v_stall.mode='shared') then
   raise exception 'This stall/venue does not support your setup requirements';end if;
 if exists(select 1 from public.bookings where merchant_id=v_user and event_id=p_event_id and
     (status in ('approved','pending_review') or(status='pending_payment' and reservation_expires_at>now()))) then
   raise exception 'You already have an active booking for this event';end if;
 select count(*) into v_cnt from public.bookings where stall_id=v_stall.id and
    (status in ('approved','pending_review') or(status='pending_payment' and reservation_expires_at>now()));
 if v_cnt >= (case when v_stall.mode='solo' then 1 else 2 end) then raise exception 'Stall is already full';end if;
 if v_stall.mode='shared' and v_cnt=1 then
   select * into v_other from public.bookings where stall_id=v_stall.id and
     (status in ('approved','pending_review') or(status='pending_payment' and reservation_expires_at>now())) limit 1;
   if v_other.status<>'approved' then raise exception 'First merchant is awaiting approval';end if;
   if v_other.merchant_id=v_user then raise exception 'Cannot share with your own account';end if;
   select * into v_other_profile from public.merchant_profiles where user_id=v_other.merchant_id;
   if v_profile.category=v_other.category_snapshot or v_profile.product_tags && v_other.product_tags_snapshot then
     raise exception 'Conflicting products or category. Choose another stall';end if;
   if v_profile.space_units+v_other_profile.space_units>2 then raise exception 'Not enough shared booth space';end if;
   v_review := not public.is_auto_pair(v_profile.category,v_other.category_snapshot);
 end if;
 v_total:=case when v_stall.mode='solo' then v_event.solo_price else v_event.shared_price end;
 -- Lock supply records in a deterministic order, including same-stall and overlapping-event allocations.
 for v_item in select elem from jsonb_array_elements(coalesce(p_supplies,'[]'::jsonb)) x(elem)
   order by elem->>'id' loop
   if coalesce(v_item->>'qty','') !~ '^[1-5]$' then raise exception 'Invalid equipment quantity';end if;
   v_qty:=(v_item->>'qty')::integer;
   v_supply_id:=(v_item->>'id')::uuid;
   if v_supply_id=any(v_seen) then raise exception 'Duplicate equipment option';end if;
   v_seen:=array_append(v_seen,v_supply_id);
   select * into v_supply from public.supplies where id=v_supply_id and enabled for update;
   if not found then raise exception 'Equipment option is unavailable';end if;
   if exists(select 1 from public.booking_supplies x join public.bookings b on b.id=x.booking_id
      where b.merchant_id=v_user and b.event_id=p_event_id and x.supply_id=v_supply.id
      and b.status in ('pending_review','approved')) then raise exception 'Duplicate equipment selection';end if;
   select coalesce(sum(bs.qty),0) into v_used from public.booking_supplies bs
      join public.bookings b on b.id=bs.booking_id join public.events e on e.id=b.event_id
      where bs.supply_id=v_supply.id and e.starts_at<v_event.ends_at and e.ends_at>v_event.starts_at
      and (b.status in ('pending_review','approved') or (b.status='pending_payment' and b.reservation_expires_at>now()));
   if v_used+v_qty>v_supply.total_stock then raise exception 'Insufficient stock for %',v_supply.name;end if;
   if v_supply.one_per_stall then
     select coalesce(sum(bs.qty),0) into v_same_stall from public.booking_supplies bs
        join public.bookings b on b.id=bs.booking_id where b.stall_id=v_stall.id and bs.supply_id=v_supply.id
        and (b.status in ('pending_review','approved') or(b.status='pending_payment' and b.reservation_expires_at>now()));
     if v_same_stall+v_qty>1 then raise exception 'This equipment is limited to one per stall';end if;
   end if;
   v_total:=v_total+v_qty*v_supply.price;
 end loop;
 insert into public.bookings(merchant_id,event_id,stall_id,mode,declared_products,product_tags_snapshot,category_snapshot,
    needs_match_review,total_amount,reservation_expires_at)
   values(v_user,p_event_id,v_stall.id,v_stall.mode,trim(p_products),v_profile.product_tags,v_profile.category,
   v_review,v_total,now()+interval '30 minutes') returning id into v_id;
 for v_item in select elem from jsonb_array_elements(coalesce(p_supplies,'[]'::jsonb)) x(elem) loop
   insert into public.booking_supplies(booking_id,supply_id,qty,unit_price)
   select v_id,s.id,(v_item->>'qty')::integer,s.price from public.supplies s where s.id=(v_item->>'id')::uuid;
 end loop;
 return v_id;
end $$;

-- Payment proof remains unverified until the organizer reconciles it manually.
create function public.submit_payment(p_booking_id uuid,p_method_id uuid,p_reference text,p_proof_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings%rowtype;
begin
 if auth.uid() is null then raise exception 'Please sign in';end if;
 select * into v_booking from public.bookings where id=p_booking_id and merchant_id=auth.uid() for update;
 if not found or v_booking.status<>'pending_payment' or v_booking.reservation_expires_at<=now() then
  raise exception 'Reservation has expired or cannot accept payment proof';end if;
 if not exists(select 1 from public.payment_methods where id=p_method_id and enabled) then raise exception 'Invalid payment method';end if;
 if length(trim(coalesce(p_reference,'')))<4 then raise exception 'Enter your payment reference number';end if;
 if p_proof_path not like auth.uid()::text || '/' || p_booking_id::text || '/%' then raise exception 'Invalid proof storage path';end if;
 if not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=p_proof_path) then raise exception 'Payment file not uploaded';end if;
 update public.bookings set status='pending_review',payment_status='reported',payment_method_id=p_method_id,
    payment_reference=trim(p_reference),proof_path=p_proof_path,reservation_expires_at=null where id=p_booking_id;
end $$;

-- Explicit cancellation of a reservation awaiting review (approved bookings require admin assistance).
create function public.cancel_my_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_stall uuid;v_booking public.bookings%rowtype;
begin
 select stall_id into v_stall from public.bookings where id=p_booking_id and merchant_id=auth.uid();
 if v_stall is null then raise exception 'Booking not found';end if;
 perform 1 from public.stalls where id=v_stall for update;
 select * into v_booking from public.bookings where id=p_booking_id and merchant_id=auth.uid() for update;
 if v_booking.status not in ('pending_payment','pending_review') then raise exception 'Ask the organizer to cancel approved bookings';end if;
 update public.bookings set status='cancelled',payment_status=case when proof_path is null then 'not_submitted' else 'refund_due' end,
   review_note='Cancelled by merchant; organizer to reconcile any reported payment' where id=p_booking_id;
end $$;

create function public.review_merchant(p_user_id uuid,p_verify boolean,p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc text;
begin
 if not private.is_admin() then raise exception 'Admin authorization required';end if;
 select doc_path into v_doc from public.merchant_profiles where user_id=p_user_id for update;
 if v_doc is null or not exists(select 1 from storage.objects where bucket_id='merchant-docs' and name=v_doc) then
    raise exception 'Document not found';end if;
 if not p_verify and exists(select 1 from public.bookings b join public.events e on e.id=b.event_id
   where b.merchant_id=p_user_id and b.status='approved' and e.ends_at>now()) then
   raise exception 'Cancel active approved bookings before revoking merchant verification';end if;
 update public.merchant_profiles set verification_status=case when p_verify then 'verified' else 'rejected' end,
  verification_note=nullif(trim(p_note),'') where user_id=p_user_id;
end $$;

create function public.review_booking(p_booking_id uuid,p_approve boolean,p_note text default '',p_override_manual boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_stall uuid;v_b public.bookings%rowtype;v_p public.merchant_profiles%rowtype;
 v_partner public.bookings%rowtype;v_count integer;
begin
 if not private.is_admin() then raise exception 'Admin authorization required';end if;
 select stall_id into v_stall from public.bookings where id=p_booking_id;
 if v_stall is null then raise exception 'Booking not found';end if;
 perform 1 from public.stalls where id=v_stall for update;
 select * into v_b from public.bookings where id=p_booking_id for update;
 if v_b.status<>'pending_review' then raise exception 'Only pending bookings can be reviewed';end if;
 if p_approve then
  select * into v_p from public.merchant_profiles where user_id=v_b.merchant_id;
  if v_p.verification_status<>'verified' then raise exception 'Verify merchant first';end if;
  if v_b.proof_path is null or not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=v_b.proof_path) then
   raise exception 'No uploaded proof';end if;
  -- Admin must independently verify the payment against its actual transaction ledger.
  if v_b.needs_match_review and not p_override_manual then
   raise exception 'Manual category pairing must be expressly approved by admin';end if;
  select count(*) into v_count from public.bookings b where b.stall_id=v_b.stall_id and b.id<>v_b.id and b.status='approved';
  if v_b.mode='solo' and v_count>0 then raise exception 'Solo stall already occupied';end if;
  if v_b.mode='shared' and v_count>0 then
    select * into v_partner from public.bookings where stall_id=v_b.stall_id and id<>v_b.id and status='approved' limit 1;
    if v_b.category_snapshot=v_partner.category_snapshot or v_b.product_tags_snapshot && v_partner.product_tags_snapshot then
      raise exception 'Category/product overlap with approved stall partner';end if;
  end if;
  update public.bookings set status='approved',payment_status='verified',approved_at=now(),review_note=nullif(trim(p_note),'') where id=p_booking_id;
 else
  update public.bookings set status='declined',payment_status='refund_due',review_note=coalesce(nullif(trim(p_note),''),'Please contact the organizer for details') where id=p_booking_id;
 end if;
end $$;

create function public.admin_cancel_booking(p_booking_id uuid,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_stall uuid; v_b public.bookings%rowtype;
begin
 if not private.is_admin() then raise exception 'Admin authorization required';end if;
 select stall_id into v_stall from public.bookings where id=p_booking_id;
 if v_stall is null then raise exception 'Not found';end if;
 perform 1 from public.stalls where id=v_stall for update;
 select * into v_b from public.bookings where id=p_booking_id for update;
 if v_b.status in ('cancelled','declined','expired') then raise exception 'Already inactive';end if;
 update public.bookings set status='cancelled',payment_status=case when proof_path is null then 'not_submitted' else 'refund_due' end,
 review_note=coalesce(nullif(trim(p_note),''),'Cancelled by organizer') where id=p_booking_id;
end $$;

-- Simple authenticated organizer check-in: no public, forgeable "approval" QR.
create function public.admin_check_in(p_booking_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings%rowtype;
begin
 if not private.is_admin() then raise exception 'Admin authorization required';end if;
 select * into v_b from public.bookings where id=p_booking_id for update;
 if not found or v_b.status<>'approved' then raise exception 'No approved booking matches this pass';end if;
 if v_b.mode='shared' and (select count(*) from public.bookings where stall_id=v_b.stall_id and status='approved')<>2 then
   raise exception 'Buddy pairing is not yet fully approved';end if;
 if not exists(select 1 from public.events e where e.id=v_b.event_id
     and e.starts_at<=now()+interval '1 day' and e.ends_at>=now()-interval '1 day' and e.status<>'cancelled') then
     raise exception 'Check-in is only valid around the scheduled event dates';end if;
 if v_b.checked_in_at is not null then raise exception 'Pass already checked in';end if;
 update public.bookings set checked_in_at=now() where id=p_booking_id;
 return 'Check-in completed';
end $$;

-- Reconcile refunds only after an actual refund has been sent and independently checked.
create function public.admin_mark_refunded(p_booking_id uuid,p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not private.is_admin() then raise exception 'Admin authorization required';end if;
 if length(trim(coalesce(p_reference,'')))<4 then raise exception 'Real refund reference required';end if;
 update public.bookings set payment_status='refunded',refund_reference=trim(p_reference),refunded_at=now()
  where id=p_booking_id and payment_status='refund_due';
 if not found then raise exception 'Booking is not awaiting refund reconciliation';end if;
end $$;

-- Only disclose a partner's contact AFTER both occupants have approved bookings.
create function public.get_confirmed_buddy(p_booking_id uuid)
returns table(brand_name text,owner_name text,social text,category text,product_list text)
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings%rowtype;
begin
 select * into v_b from public.bookings where id=p_booking_id and merchant_id=auth.uid() and status='approved';
 if not found or v_b.mode<>'shared' then return;end if;
 if (select count(*) from public.bookings where stall_id=v_b.stall_id and status='approved')<>2 then return;end if;
 return query select p.brand_name,p.owner_name,p.social,p.category,p.product_list from public.bookings b
 join public.merchant_profiles p on p.user_id=b.merchant_id
 where b.stall_id=v_b.stall_id and b.id<>v_b.id and b.status='approved';
end $$;

create function public.get_gate_pass(p_booking_id uuid)
returns table(pass_id uuid,stall_code text,event_title text,brand_name text,products text)
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings%rowtype;
begin
 select * into v_b from public.bookings where id=p_booking_id and merchant_id=auth.uid() and status='approved';
 if not found then return;end if;
 if v_b.mode='shared' and (select count(*) from public.bookings where stall_id=v_b.stall_id and status='approved')<>2 then return;end if;
 return query select v_b.id,s.code,e.title,p.brand_name,v_b.declared_products from public.stalls s
 join public.events e on e.id=s.event_id join public.merchant_profiles p on p.user_id=v_b.merchant_id
 where s.id=v_b.stall_id;
end $$;

revoke all on function public.is_auto_pair(text,text), public.get_stall_options(uuid),public.create_booking(uuid,uuid,text,jsonb),
 public.submit_payment(uuid,uuid,text,text),public.cancel_my_booking(uuid),public.review_merchant(uuid,boolean,text),
 public.review_booking(uuid,boolean,text,boolean),public.admin_cancel_booking(uuid,text),
 public.get_confirmed_buddy(uuid),public.get_gate_pass(uuid),public.admin_check_in(uuid),public.admin_mark_refunded(uuid,text) from public,anon;
grant execute on function public.is_auto_pair(text,text),public.get_stall_options(uuid),
 public.create_booking(uuid,uuid,text,jsonb),public.submit_payment(uuid,uuid,text,text),public.cancel_my_booking(uuid),
 public.review_merchant(uuid,boolean,text),public.review_booking(uuid,boolean,text,boolean),
 public.admin_cancel_booking(uuid,text),public.get_confirmed_buddy(uuid),public.get_gate_pass(uuid),public.admin_check_in(uuid),public.admin_mark_refunded(uuid,text) to authenticated;

-- Example starter rental inventory (editable by admin). No fabricated events, merchants or payment details.
insert into public.supplies(name,specs,price,total_stock,one_per_stall) values
 ('White Canopy Tent','2 m × 2 m; 1 unit',400,25,true),
 ('Folding Display Table','6 ft × 2.5 ft, fitted cover; 1 unit',300,40,false),
 ('Warm Booth Spotlights','2 × warm LED clamp lights; 1 set',250,30,false),
 ('Garment Rack & Extra Chairs','1 rack + 2 folding chairs; 1 set',200,35,false);
