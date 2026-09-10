export const ADMIN_SESSION_COOKIE = "enemlab_admin";
export const ADMIN_SESSION_VALUE = process.env.ENEMLAB_SESSION_TOKEN ?? "enemlab-local-admin";
export const ADMIN_USERNAME = process.env.ENEMLAB_ADMIN_USER ?? "admin";
export const ADMIN_PASSWORD = process.env.ENEMLAB_ADMIN_PASSWORD ?? "admin";

export function hasAdminSession(value: string | undefined) {
  return value === ADMIN_SESSION_VALUE;
}
