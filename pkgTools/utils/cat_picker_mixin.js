// utils/cat_picker_mixin.js
// ─────────────────────────────────────────────────────────────────────────────
// 分层选择器（大类 → 小类两级下钻 + 常用前置）
//
// 解决的问题（2026-10-06，用户原话「一次性把所有的类目都放在那里选择」观感很差）：
//   旧模式把**所有**类目一次性平铺。金句页是 6 个大类 + 全部标签云（标签随收藏无限增长，
//   几十个 tag 一次性铺满屏幕），天气页是 8 天气 × 8 心情两段共 16 个格子。
//   结果：页面一进来就是一大片选项墙，用户找不到起点，也感觉不出「该选哪个」。
//
// 本 mixin 的三层结构：
//   ① 常用区（hot）：最常用的 4 个，直接单行铺在顶部，不用展开——降低首次选择成本。
//   ② 大类区（groups）：一行大类 chip，点中后**只展开这一个**大类下的小类。
//      同时只展开一个大类（点别的大类会切换，而不是全部展开）。
//   ③ 小类区（当前大类的 items）：从属关系清晰，用户永远只面对 4~8 个小类。
//
// 设计约束（别改回去）：
//   · 常用项必须**真实常用**，不允许写死凑数。若某组没有 hot 概念就别硬套。
//   · 大类不宜超过 8 个；超过就该合并或换成分段控件，不是继续加 chip。
//   · 小类超过 12 个时用 scroll-view 横向滚，别纵向撑爆页面。
//
// 四页共用（金句/天气/节气/台词），避免各页各写一套又走形。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

/**
 * 构造分层选择器的 data 与方法。
 *
 * opts = {
 *   groups: [{ key, name, icon?, items: [{ key, name, icon? }] }],
 *   hotKeys: ['groupKey:itemKey', ...],   // 常用项，跨组，最多 4 个，按使用频次排前
 *   activeGroup: '初始大类 key',
 *   activeItem:  '初始小类 key',
 *   groupLabel:  '大类区标题'（如 '分类'）,
 *   itemLabel:   '小类区标题'（如 '标签'）,
 * }
 * 返回 { data, methods }
 */
function build(opts) {
  const groups = opts.groups || [];
  const hotKeys = opts.hotKeys || [];

  // 常用区：按 hotKeys 顺序从 groups 里取实际存在的项；顺手记下它属于哪个大类，
  // 这样点常用项时能同时把大类切过去，小类区跟着联动（否则会出现「常用高亮但小类区没同步」的错觉）。
  const hot = hotKeys.map(k => {
    const i = k.indexOf(':');
    if (i < 0) return null;
    const gk = k.slice(0, i), ik = k.slice(i + 1);
    const g = groups.find(x => x.key === gk);
    if (!g) return null;
    const it = (g.items || []).find(x => x.key === ik);
    if (!it) return null;
    return { groupKey: gk, key: ik, name: it.name, icon: it.icon || g.icon || '' };
  }).filter(Boolean);

  // 每个大类标记它是否有常用项 —— 有的话大类 chip 上加个小圆点，暗示「里面有你常用的」
  const groupsWithDot = groups.map(g => Object.assign({}, g, { hot: !!hot.find(h => h.groupKey === g.key) }));

  const activeGroup = opts.activeGroup || (groups[0] && groups[0].key) || '';
  const curGroup = groups.find(g => g.key === activeGroup) || groups[0] || { items: [] };

  return {
    data: {
      // ── 分层选择器（WXML 渲染就靠这几个字段）──
      pgGroups: groupsWithDot,
      pgHot: hot,
      pgGroup: activeGroup,          // 当前展开的大类
      pgGroupName: curGroup.name,      // 小类区标题里回显大类名
      pgItems: curGroup.items || [],   // 只展示当前大类下的小类
      pgItem: opts.activeItem || ((curGroup.items || [])[0] || {}).key || '',
      pgGroupOpen: !!activeGroup,      // 默认展开第一个大类，省一次点击
      groupLabel: opts.groupLabel || '分类',
      itemLabel: opts.itemLabel || ''
    },

    methods: {
      /** 切换大类：点同一个 → 收起小类区（再点一下收起，符合直觉）；点别的 → 切换展开 */
      onPickGroup(e) {
        const gk = e.currentTarget.dataset.group;
        if (this.data.pgGroup === gk) {
          this.setData({ pgGroupOpen: !this.data.pgGroupOpen });
          return;
        }
        const g = this.data.pgGroups.find(x => x.key === gk);
        if (!g) return;
        const items = g.items || [];
        this.setData({
          pgGroup: gk,
          pgGroupName: g.name,
          pgItems: items,
          pgItem: (items[0] || {}).key || '',
          pgGroupOpen: true
        });
        // 小类默认落在第一个上——顺手把页面侧的生效值同步掉，
        // 否则会出现「小类区高亮了 A，但卡片还是上一个 B 的内容」这种错觉。
        if (typeof this._pickerOnChange === 'function') this._pickerOnChange(items[0] || null);
      },

      /** 选小类 */
      onPickGroupItem(e) {
        const ik = e.currentTarget.dataset.item;
        const gk = e.currentTarget.dataset.group || this.data.pgGroup;
        this.setData({ pgItem: ik });
        const g = this.data.pgGroups.find(x => x.key === gk);
        const it = g && (g.items || []).find(x => x.key === ik);
        if (typeof this._pickerOnChange === 'function') this._pickerOnChange(it || null);
      },

      /** 点常用项：同时把大类切过去（小类区跟着联动），再选中该项 */
      onPickHot(e) {
        const gk = e.currentTarget.dataset.group;
        const ik = e.currentTarget.dataset.item;
        const g = this.data.pgGroups.find(x => x.key === gk);
        if (!g) return;
        const it = (g.items || []).find(x => x.key === ik);
        this.setData({
          pgGroup: gk,
          pgGroupName: g.name,
          pgItems: g.items || [],
          pgItem: ik,
          pgGroupOpen: true
        });
        if (typeof this._pickerOnChange === 'function') this._pickerOnChange(it || null);
      },

      /**
       * 页面侧在别处改了选中值（比如「换一条」后定位到别的项）时，反向同步高亮。
       * item = { groupKey, key } | null
       */
      syncPicker(item) {
        if (!item || !item.key) return;
        const gk = item.groupKey || this.data.pgGroup;
        const g = this.data.pgGroups.find(x => x.key === gk);
        if (!g) return;
        const patch = { pgItem: item.key };
        // 只有大类真的不同才改大类，避免无谓地收起用户正在看的小类区
        if (gk !== this.data.pgGroup) {
          patch.pgGroup = gk;
          patch.pgGroupName = g.name;
          patch.pgItems = g.items || [];
          patch.pgGroupOpen = true;
        }
        this.setData(patch);
      }
    }
  };
}

module.exports = { build };