export function safePreviewReturnTo(value: string | string[] | undefined, testId: string) {
  const fallback = `/admin/tests/${testId}`;
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || candidate.includes("\\") || /[\u0000-\u001f]/.test(candidate)) return fallback;
  try {
    const url = new URL(candidate, "http://nsp.internal");
    if (url.origin !== "http://nsp.internal") return fallback;
    if (url.pathname !== "/admin/tests" && !url.pathname.startsWith("/admin/tests/")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function testPreviewHref(testId: string, returnTo: string) {
  return `/admin/tests/${testId}/preview?returnTo=${encodeURIComponent(returnTo)}`;
}
