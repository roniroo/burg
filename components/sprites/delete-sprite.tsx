"use client";

import { useRouter } from "next/navigation";
import { deleteSprite } from "@/lib/actions/sprites";
import { ConfirmPair } from "@/components/city/demolish-button";

/** Take a sprite out of the library. Buildings wearing it keep standing. */
export function DeleteSprite({ spriteId, name, uses }: { spriteId: string; name: string; uses: number }) {
  const router = useRouter();

  return (
    <ConfirmPair
      idle="Delete"
      armed="Delete it"
      busy="Deleting…"
      question={
        uses === 0
          ? `Delete ${name}?`
          : uses === 1
            ? `Delete ${name}? The building wearing it goes back to its usual look.`
            : `Delete ${name}? The ${uses} buildings wearing it go back to their usual look.`
      }
      onConfirm={async () => {
        const result = await deleteSprite({ spriteId });
        if (result.ok) router.refresh();
        return result;
      }}
    />
  );
}
