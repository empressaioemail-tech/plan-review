/**
 * Unauthed ICC content 401. Gate sets pr_persona cookie.
 * PLAN-ROW G-60 / WDLL item 3.
 */

export const config = {
  matcher: ["/icc/:path*"],
};

export default function middleware(request) {
  const url = new URL(request.url);
  const cookie = request.headers.get("cookie") || "";
  const fromCookie = cookie.match(/(?:^|;\s*)pr_persona=([^;]+)/);
  const persona =
    (fromCookie && decodeURIComponent(fromCookie[1])) ||
    url.searchParams.get("persona") ||
    "";
  if (!persona) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        message: "Unauthed ICC content is refused. Open /gate and pick a persona.",
      }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      },
    );
  }
}