import { readData } from "../../../../lib/data.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* 只读白名单：防止路径穿越。name 只允许三个已知数据源。 */
export async function GET(request, { params }) {
  const { name } = await params;
  const data = await readData(name);
  if (!data) {
    return Response.json({ error: "not_found", allowed: ["netease", "steam", "previews"] },
                         { status: 404 });
  }
  return Response.json(data, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      /* 静态站是 no-cache；这里给 60s 边缘缓存，既新鲜又挡住重复回源 */
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
