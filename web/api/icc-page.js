/**
 * Plan-review no longer hosts ICC Demo. Separate portal, separate domain.
 * PLAN-ROW G-60 / A-033.
 */

export default function handler(req, res) {
  res.status(410).json({
    error: "gone",
    message: "ICC Demo is a separate portal and domain. It is not a path on plan-review-app.",
    portal: process.env.ICC_PORTAL_URL || "https://icc-portal-app.vercel.app",
  });
}
