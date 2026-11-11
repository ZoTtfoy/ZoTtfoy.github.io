/* ==========================================================================
 *  最近入库：差集记账（纯函数，不碰网络 / 不碰时钟 / 不碰文件）
 * --------------------------------------------------------------------------
 *  为什么需要这一小块东西：
 *    Steam 的 IPlayerService/GetOwnedGames 返回的字段里**没有"购买时间"**。
 *    唯一沾时间的是 rtime_last_played —— 那是"最后游玩"，不是"入库"。
 *    所以「最近入库了什么」只能靠自己记账：
 *
 *      第 1 次同步  → 全库 appid 存成基线（owned），不产出任何"新入库"
 *      第 N 次同步  → 拿本次全库 ∩ 基线，差集就是这期间新增的
 *                    → 追加到 added（新记录在前），并保留历史（最多 12 条）
 *                    → 基线换成本次的全库，下次继续比
 *
 *  抽成纯函数而不是塞在 main() 里，是为了能用假数据跑测试：
 *  tools/verify-steam-added.js 覆盖了首次建基线 / 无变化 / 新增一款 /
 *  连续多次累积 / 超出 12 条截断 / 重复 appid 这几种情况。
 * ========================================================================== */

/* 最多留几条。12 条 ≈ 横向封面带放 8 个 + “+N” 的那一档，
   再多了这一块会比游戏列表还长，喧宾夺主。 */
export const ADDED_LIMIT = 12;

/**
 * @param {object|null} prev   上一次的 data/steam.json（第一次跑传 null）
 * @param {Array<{appid:number,name:string}>} owned  本次 API 返回的全库
 * @param {string} today       YYYY-MM-DD。由调用方给，纯函数不读系统时间
 * @returns {{added:Array, ownedSince:string, fresh:Array, baseline:boolean}}
 *   added      累积的入库记录（新 → 旧，最多 ADDED_LIMIT 条）
 *   ownedSince 从哪天开始记账（首次建基线 = today）
 *   fresh      本次新发现的（只用来打日志）
 *   baseline   本次是不是"只建基线、不产出记录"
 */
export function diffRecentlyAdded(prev, owned, today) {
  /* prev 可能是 null，也可能是早期版本写的、没有 added 字段的旧 JSON —— 都按空处理 */
  const prevAdded = Array.isArray(prev && prev.added) ? prev.added : [];
  const prevOwned = prev && Array.isArray(prev.owned) ? prev.owned : null;
  const list = Array.isArray(owned) ? owned : [];

  let added = prevAdded.slice();
  let ownedSince = (prev && prev.ownedSince) || "";

  /* 拿不到全库（API 失败 / 空库）就原样返回，别把已有记录冲掉。
     这条分支很重要：某天 Steam 抽风返回空数组时，added 不能清零。 */
  if (!list.length) {
    return { added, ownedSince, fresh: [], baseline: false };
  }

  /* 首次同步：只有基线，没有差集可算。
     如果这时候把 143 款全算成"新入库"，页面会变成一堵墙 —— 所以这里刻意只建基线。 */
  if (!prevOwned) {
    return { added: [], ownedSince: today, fresh: [], baseline: true };
  }

  const seen = new Set(prevOwned.map((g) => g && g.appid));
  /* 去重：同一个 appid 在 API 返回里出现两次（极少见，但免费游戏+套装会有）不该记两条 */
  const fresh = list.filter((g) => g && !seen.has(g.appid));

  if (fresh.length) {
    added = fresh
      .map((g) => ({ appid: g.appid, name: g.name || String(g.appid), at: today }))
      .concat(added)
      .slice(0, ADDED_LIMIT);
  }

  return { added, ownedSince, fresh, baseline: false };
}
