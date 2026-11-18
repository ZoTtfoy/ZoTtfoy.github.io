export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    runtime: "vercel-function",
    node: process.version,
    region: process.env.VERCEL_REGION || "local",
    env: process.env.VERCEL_ENV || "development",
    ts: new Date().toISOString(),
  });
}
