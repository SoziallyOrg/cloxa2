"use client";

import { createContext, use, type ReactNode } from "react";

import { Logo } from "../brand/Logo";
import { RoleSwitch } from "../ui/RoleSwitch";
import { shouldShowRoleSwitch } from "../ui/role-switch";

const CanManageContext = createContext(false);

/** Tells Klok whether the role switch shows: Klok draws its own top row inside the hero. */
export function CanManageProvider({
  canManage,
  children,
}: {
  canManage: boolean;
  children: ReactNode;
}) {
  return <CanManageContext value={canManage}>{children}</CanManageContext>;
}

/**
 * Phone top row for Klok: logo left, role switch right. Klok has no frame
 * top bar because the status block runs to the top of the screen, so the row
 * takes the block's colour (light letters on forest, dark on amber and white).
 */
export function KlokTopBar({ onForest }: { onForest: boolean }) {
  const canManage = use(CanManageContext);
  const roles = { current: "app", hasEmployee: true, canManage } as const;
  return (
    <div className="flex items-center justify-between gap-3 px-gutter pt-[calc(env(safe-area-inset-top)+0.75rem)] md:hidden">
      <Logo tone={onForest ? "on-forest" : "on-light"} />
      {shouldShowRoleSwitch(roles) ? (
        <RoleSwitch
          {...roles}
          tone={onForest ? "on-forest" : "on-light"}
          className="w-56 max-w-[62%]"
        />
      ) : null}
    </div>
  );
}
