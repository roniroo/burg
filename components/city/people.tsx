"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  changeMemberRole,
  inviteToCity,
  leaveCity,
  removeMember,
  revokeInvite,
} from "@/lib/actions/members";
import Link from "next/link";
import type { CityInvite, CityPerson, CityRole } from "@/lib/queries";

/**
 * Who can reach this city.
 *
 * Only the owner sees the controls. Everyone else sees the list, because
 * knowing who else is in a shared space is not a privilege — and a viewer who
 * cannot tell whether anyone else can read their notes is being kept in the
 * dark about their own data.
 */

const BUTTON = "border-2 border-ink px-2 py-1 font-pixel text-[10px] uppercase shadow-hard disabled:opacity-50";

const ROLE_NOTE: Record<CityRole, string> = {
  owner: "founded it; manages people",
  editor: "can build and demolish",
  viewer: "can read, not change",
};

export function People({
  cityId,
  cityName,
  role,
  people,
  invites,
  paid,
}: {
  cityId: string;
  cityName: string;
  role: CityRole;
  people: CityPerson[];
  invites: CityInvite[];
  /** Whether this city's owner is on the paid plan. Collaborators are the
      paid feature, so a free owner is shown why rather than an invite form
      that can only fail. */
  paid: boolean;
}) {
  const router = useRouter();
  const isOwner = role === "owner";

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      done?.();
      router.refresh();
    });

  return (
    <section aria-labelledby="people" className="mt-10">
      <h2 id="people" className="font-display text-xl">
        People
      </h2>
      <p className="mt-1 font-body text-sm text-stone">
        {people.length === 1
          ? `Only you can reach ${cityName}.`
          : `${people.length} people can reach ${cityName}.`}
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {people.map((person) => (
          <li
            key={person.userId}
            className="flex flex-wrap items-center gap-2 border-2 border-ink bg-snow px-3 py-2"
          >
            <span className="font-body text-sm">
              {person.name}
              {person.isYou ? <span className="ml-1 text-stone">(you)</span> : null}
            </span>
            <span className="font-pixel text-[10px] uppercase text-stone">
              {person.role} — {ROLE_NOTE[person.role]}
            </span>

            {isOwner && person.role !== "owner" ? (
              <span className="ml-auto flex items-center gap-2">
                <label className="sr-only" htmlFor={`role-${person.userId}`}>
                  Role for {person.name}
                </label>
                <select
                  id={`role-${person.userId}`}
                  value={person.role}
                  disabled={pending}
                  onChange={(e) =>
                    run(() =>
                      changeMemberRole({
                        cityId,
                        userId: person.userId,
                        role: e.target.value as "editor" | "viewer",
                      }),
                    )
                  }
                  className="border-2 border-ink bg-paper px-2 py-1 font-pixel text-[10px] uppercase"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeMember({ cityId, userId: person.userId }))}
                  className={`${BUTTON} bg-paper text-ink`}
                >
                  Remove
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {invites.length > 0 ? (
        <>
          <h3 className="mt-6 font-pixel text-[10px] uppercase text-stone">Invited, not yet arrived</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center gap-2 border-2 border-mist bg-paper px-3 py-2"
              >
                <span className="font-body text-sm text-slate">{invite.email}</span>
                <span className="font-pixel text-[10px] uppercase text-stone">{invite.role}</span>
                {isOwner ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => revokeInvite({ inviteId: invite.id }))}
                    className={`${BUTTON} ml-auto bg-snow text-ink`}
                  >
                    Cancel
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-body text-xs text-stone">
            An invitation is claimed the next time that address signs in. Burg is invite-only, so
            they will need an account making for them first.
          </p>
        </>
      ) : null}

      {isOwner && !paid ? (
        <div className="mt-6 border-2 border-ink bg-paper p-3">
          <h3 className="font-pixel text-[10px] uppercase text-stone">Sharing this city</h3>
          <p className="mt-2 font-body text-sm text-slate">
            Inviting people is the paid plan. The free plan is a city of your own — the
            moment it is a city other people can reach, it is doing the thing worth paying
            for.
          </p>
          <Link
            href="/plan"
            className="mt-3 inline-block border-2 border-ink bg-gold px-3 py-1 font-pixel text-[10px] uppercase text-ink shadow-hard"
          >
            See the plan
          </Link>
        </div>
      ) : isOwner ? (
        <form
          className="mt-6 flex flex-wrap items-end gap-2 border-2 border-ink bg-snow p-3 shadow-hard"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => inviteToCity({ cityId, email, role: inviteRole }),
              () => {
                setMessage(`Invited ${email.trim()}.`);
                setEmail("");
              },
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-email" className="font-pixel text-[10px] uppercase text-stone">
              Invite someone
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="them@example.com"
              className="w-56 border-2 border-ink bg-paper px-2 py-1 font-body text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-role" className="font-pixel text-[10px] uppercase text-stone">
              As
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
              className="border-2 border-ink bg-paper px-2 py-1 font-pixel text-[10px] uppercase"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </div>
          <button type="submit" disabled={pending} className={`${BUTTON} bg-amber text-ink`}>
            {pending ? "…" : "Send invite"}
          </button>
        </form>
      ) : (
        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => leaveCity({ cityId }), () => router.push("/city"));
          }}
        >
          <button type="submit" disabled={pending} className={`${BUTTON} bg-paper text-ink`}>
            Leave {cityName}
          </button>
        </form>
      )}

      {error ? (
        <p role="alert" className="mt-2 font-body text-xs text-brick">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-2 font-body text-xs text-slate">
          {message}
        </p>
      ) : null}
    </section>
  );
}
