/**
 * Full page load to a path on this site. Used deliberately after sign-in, sign-out and session
 * expiry so every cached reading, alert and user detail is dropped from memory.
 */
export function hardNavigate(path: string): void {
  window.location.replace(new URL(path, window.location.origin).href);
}
