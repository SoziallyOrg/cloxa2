/**
 * The role switch ("Mijn klok | Beheer") only exists for someone who is both
 * an employee (has a clock) and a manager, admin or owner. Everyone else has
 * one area and nothing to switch.
 */
export function shouldShowRoleSwitch(input: {
  hasEmployee: boolean;
  canManage: boolean;
}): boolean {
  return input.hasEmployee && input.canManage;
}
