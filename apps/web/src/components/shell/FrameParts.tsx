import { Logo, LogoMark } from "../brand/Logo";
import { RoleSwitch } from "../ui/RoleSwitch";
import { shouldShowRoleSwitch } from "../ui/role-switch";

export interface FrameRoles {
  current: "app" | "manage";
  hasEmployee: boolean;
  canManage: boolean;
}

/** Sidebar top: the logo (the app tile on tablets) and the role switch. */
export function SidebarHead(roles: FrameRoles) {
  return (
    <>
      <div className="flex justify-center px-1 lg:justify-start lg:px-2">
        <span className="hidden lg:inline-flex">
          <Logo />
        </span>
        <span className="lg:hidden">
          <LogoMark />
        </span>
      </div>
      {shouldShowRoleSwitch(roles) ? (
        <>
          <div className="hidden lg:block">
            <RoleSwitch {...roles} />
          </div>
          <div className="lg:hidden">
            <RoleSwitch {...roles} variant="icons" />
          </div>
        </>
      ) : null}
    </>
  );
}

/** Phone top row: the logo left, the role switch right (only when there is one). */
export function PhoneTopBar(roles: FrameRoles) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Logo />
      {shouldShowRoleSwitch(roles) ? (
        <RoleSwitch {...roles} className="w-56 max-w-[62%]" />
      ) : null}
    </div>
  );
}
