"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_CITY_COOKIE } from "@/lib/queries";
import type { ActionResult } from "@/lib/actions/city";
import { COLLABORATORS_ARE_PAID } from "@/lib/plan";

/**
 * Who can reach a city.
 *
 * Every one of these is guarded by RLS rather than by a check written here:
 * the `city_members_owner_*` and `city_invites_owner_*` policies mean a
 * non-owner's statement simply matches no rows. The reads below are for the
 * message, not for the permission.
 *
 * Inviting additionally requires the city's owner to be on the paid plan --
 * collaborators are the thing being sold -- which `city_invites_owner_insert`
 * enforces and `inviteToCity` explains.
 *
 * Invitations are addressed to an email, not a user id, because the app cannot
 * look a user up by address -- that needs the service role, which deliberately
 * does not exist at runtime -- and because the person may have no account yet.
 * The row waits until they sign in and `claimInvites` turns it into membership.
 */

const SHAREABLE_ROLES = ["editor", "viewer"] as const;

const inviteSchema = z.object({
  cityId: z.uuid(),
  email: z.string().trim().toLowerCase().email("That does not look like an email address."),
  role: z.enum(SHAREABLE_ROLES),
});

export async function inviteToCity(input: unknown): Promise<ActionResult<{ email: string }>> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check that invitation." };
  }
  const { cityId, email, role } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  if (user.email && user.email.toLowerCase() === email) {
    return { ok: false, error: "That is you — you are already here." };
  }

  // `city_invites_owner_insert` already requires the plan, so this is for the
  // message rather than the permission: an RLS refusal arrives as "violates
  // row-level security policy", which tells somebody nothing about what to do
  // next. The gate is still the policy.
  const { data: paid } = await supabase.rpc("city_is_paid", { target_city: cityId });
  if (paid !== true) {
    return { ok: false, error: COLLABORATORS_ARE_PAID };
  }

  const { error } = await supabase
    .from("city_invites")
    .insert({ city_id: cityId, email, role, invited_by: user.id });

  if (error) {
    // The unique index is on (city_id, lower(email)).
    if (error.code === "23505") return { ok: false, error: "They have already been invited." };
    // RLS refusing a non-owner looks like a policy violation, not a crash.
    // Either not the owner, or the plan lapsed between the check above and
    // here. Both are 42501, and the plan is the likelier of the two to have
    // changed under them.
    if (error.code === "42501") {
      return { ok: false, error: "Only the city's owner, on the paid plan, can invite people." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/directory");
  return { ok: true, data: { email } };
}

const inviteIdSchema = z.object({ inviteId: z.uuid() });

export async function revokeInvite(input: unknown): Promise<ActionResult> {
  const parsed = inviteIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invitation." };

  const supabase = await createClient();
  const { error } = await supabase.from("city_invites").delete().eq("id", parsed.data.inviteId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/directory");
  return { ok: true };
}

const memberSchema = z.object({
  cityId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(SHAREABLE_ROLES),
});

export async function changeMemberRole(input: unknown): Promise<ActionResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };
  const { cityId, userId, role } = parsed.data;

  const supabase = await createClient();
  // The schema has no way to express "exactly one owner", so the last word on
  // not demoting one is here: the enum the action accepts excludes 'owner',
  // and an owner's row is never a target.
  const { data: target } = await supabase
    .from("city_members")
    .select("role")
    .eq("city_id", cityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return { ok: false, error: "They are not a member of this city." };
  if (target.role === "owner") return { ok: false, error: "The owner's role cannot be changed." };

  const { error } = await supabase
    .from("city_members")
    .update({ role })
    .eq("city_id", cityId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/directory");
  revalidatePath("/city");
  return { ok: true };
}

export async function removeMember(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ cityId: z.uuid(), userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid removal." };
  const { cityId, userId } = parsed.data;

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("city_members")
    .select("role")
    .eq("city_id", cityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return { ok: false, error: "They are not a member of this city." };
  if (target.role === "owner") {
    return { ok: false, error: "The owner cannot be removed. Delete the city instead." };
  }

  const { error } = await supabase
    .from("city_members")
    .delete()
    .eq("city_id", cityId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/directory");
  return { ok: true };
}

/** Give up your own access to a city someone else owns. */
export async function leaveCity(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ cityId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid city." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // `city_members_leave` refuses an owner, so this is the readable version of
  // the same rule rather than a second gate.
  const { error } = await supabase
    .from("city_members")
    .delete()
    .eq("city_id", parsed.data.cityId)
    .eq("user_id", user.id)
    .neq("role", "owner");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/directory");
  revalidatePath("/city");
  return { ok: true };
}

/**
 * Turn any invitation addressed to this user into membership.
 *
 * Called from `ensureCity` on every sign-in, so an invitation sent before the
 * person had an account is waiting for them when they make one. Idempotent,
 * and safe to fail: `city_members_accept_invite` only permits an insert that
 * matches an invite's city and role exactly.
 */
export async function claimInvites(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return 0;

  const { data: invites } = await supabase.from("city_invites").select("id, city_id, role");
  if (!invites || invites.length === 0) return 0;

  let claimed = 0;
  for (const invite of invites) {
    const { error } = await supabase
      .from("city_members")
      .insert({ city_id: invite.city_id, user_id: user.id, role: invite.role });
    // Already a member is a success, not a failure: the invite still goes.
    if (!error || error.code === "23505") {
      await supabase.from("city_invites").delete().eq("id", invite.id);
      if (!error) claimed++;
    }
  }
  return claimed;
}

const switchSchema = z.object({ cityId: z.uuid() });

/**
 * Look at a different city.
 *
 * The cookie is only a preference; `getCurrentCity` re-checks it against what
 * the user can actually reach on every read, so a stale or forged value falls
 * back rather than granting anything.
 */
export async function switchCity(input: unknown): Promise<ActionResult> {
  const parsed = switchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid city." };

  const supabase = await createClient();
  const { data: city } = await supabase
    .from("cities")
    .select("id")
    .eq("id", parsed.data.cityId)
    .maybeSingle();
  if (!city) return { ok: false, error: "You cannot reach that city." };

  (await cookies()).set(ACTIVE_CITY_COOKIE, city.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
