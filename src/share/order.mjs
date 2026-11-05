export function matchShareTitles(titles, entries) {
  const remaining = (entries ?? []).map(entry => ({botId: entry.botId, botName: entry.botName}));
  const ordered = [];
  for (const title of titles ?? []) {
    const text = String(title ?? '').trim();
    const index = remaining.findIndex(entry => text === `发给 ${entry.botName}` || text === `Send to ${entry.botName}`);
    if (index < 0) continue;
    ordered.push(remaining[index].botId);
    remaining.splice(index, 1);
  }
  return ordered;
}

export function spliceWechatOrder(allIds, wechatIds, nextWechatIds) {
  const allowed = new Set(wechatIds);
  const next = [];
  for (const id of nextWechatIds ?? []) {
    if (allowed.has(id) && !next.includes(id)) next.push(id);
  }
  for (const id of wechatIds) if (!next.includes(id)) next.push(id);
  const positions = new Set(wechatIds);
  let cursor = 0;
  return allIds.map(id => positions.has(id) ? next[cursor++] : id);
}
