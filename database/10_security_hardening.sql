-- Proposed hardening for the existing workflow functions and RLS event trigger.
-- This file is a review artifact only. Do not execute it without approval and
-- verification in an isolated database first.
--
-- It changes function execution settings and privileges only; it does not alter
-- application rows or table definitions.

BEGIN;

-- Keep unqualified workflow table names resolving to PostgreSQL built-ins and
-- the intended application schema. Explicitly place pg_temp last: PostgreSQL
-- searches it first for relation/type names when it is omitted, even when
-- pg_catalog is listed first. The current Supabase project reports that anon,
-- authenticated, and service_role cannot create objects in public, but these
-- roles can create temporary objects.
ALTER FUNCTION public.update_updated_at_column()
    SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.deduct_inventory(bigint, bigint, integer)
    SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.add_inventory(bigint, bigint, integer)
    SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.transfer_inventory(bigint, bigint, bigint, integer)
    SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.reserve_inventory(bigint, bigint, integer)
    SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.release_reserved_inventory(bigint, bigint, integer)
    SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.dispatch_reserved_inventory(bigint, bigint, integer)
    SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.enforce_inventory_reservation_limit()
    SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.audit_inventory_change()
    SET search_path TO pg_catalog, public, pg_temp;

-- These inventory helpers are not part of the public Data API. The backend
-- uses the owning postgres role and does not need PostgREST RPC access for them.
REVOKE EXECUTE ON FUNCTION public.deduct_inventory(bigint, bigint, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.add_inventory(bigint, bigint, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.transfer_inventory(bigint, bigint, bigint, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reserve_inventory(bigint, bigint, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.release_reserved_inventory(bigint, bigint, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.dispatch_reserved_inventory(bigint, bigint, integer)
    FROM PUBLIC, anon, authenticated, service_role;

-- This SECURITY DEFINER event-trigger helper should only be callable by its
-- database owner through the existing event trigger, not through public roles.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
    FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
