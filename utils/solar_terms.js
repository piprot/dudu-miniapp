// utils/solar_terms.js
// ─────────────────────────────────────────────────────────────────────────
// 24 节气 + 常用节日文案库（2026-10-06 新增）
//
// 纯静态本地数据，零 AI、零网络（个人主体合规）。供「节气·今日文案」模块使用：
//   pickForToday(date) 返回今日应景文案（优先命中节气，其次节日，再次普通日兜底）。
//   节气按公历近似日期匹配（每年 ±1 天浮动，文案卡用途不需要天文级精度）。
// ─────────────────────────────────────────────────────────────────────────
'use strict';

// 二十四节气（month/day 为公历近似日期）
const SOLAR_TERMS = [
  { name: '立春', month: 2, day: 4, text: '东风带雨逐西风，大地阳和暖气生。立春，万物起始，愿你也在这新一轮回里，悄悄种下新的期待。' },
  { name: '雨水', month: 2, day: 19, text: '好雨知时节，当春乃发生。雨水润物无声，也润心——今天给干涸的念头，浇一点行动的水。' },
  { name: '惊蛰', month: 3, day: 6, text: '微雨众卉新，一雷惊蛰始。春雷一响，蛰伏的都醒了；你心里那件想了很久的事，也该动了。' },
  { name: '春分', month: 3, day: 21, text: '昼夜均，寒暑平。春分把日子对半分，也提醒我们：一半给忙碌，一半给生活本身。' },
  { name: '清明', month: 4, day: 5, text: '清明时节雨纷纷，路上行人欲断魂。去祭奠，也去踏青——记住来处，才走得更远。' },
  { name: '谷雨', month: 4, day: 20, text: '雨生百谷，万物生长。谷雨是春的尾声，把春天的积蓄，交还给即将到来的夏天。' },
  { name: '立夏', month: 5, day: 6, text: '绿树阴浓夏日长。立夏一到，日子开始热烈，愿你的热爱也如此，不降温。' },
  { name: '小满', month: 5, day: 21, text: '小满未满，恰是最好。人生不必事事圆满，留一分余地，才装得下明天的惊喜。' },
  { name: '芒种', month: 6, day: 6, text: '芒种忙种，有收有种。今天种的每一颗种子，都是秋天要回你的信。' },
  { name: '夏至', month: 6, day: 21, text: '昼晷已云极，宵漏自此长。夏至白昼最长，也愿你清醒的时间，都用在值得的人与事上。' },
  { name: '小暑', month: 7, day: 7, text: '倏忽温风至，因循小暑来。暑气初显，心先静下来，外头再热也不慌。' },
  { name: '大暑', month: 7, day: 23, text: '赤日几时过，清风无处寻。大暑最热，熬过去便是凉秋——最难的日子，也快翻篇了。' },
  { name: '立秋', month: 8, day: 8, text: '云天收夏色，木叶动秋声。立秋不是秋尽，是提醒：该把上半年的浮躁，收一收了。' },
  { name: '处暑', month: 8, day: 23, text: '处，止也，暑气至此而止。暑热退场，清爽登场，连呼吸都轻了几分。' },
  { name: '白露', month: 9, day: 8, text: '露从今夜白，月是故乡明。白露染凉，记得给远方的父母，发一句天凉添衣。' },
  { name: '秋分', month: 9, day: 23, text: '金气秋分，风清露冷秋期半。秋天把丰硕端上来，你辛苦大半年，也该尝一口甜了。' },
  { name: '寒露', month: 10, day: 8, text: '袅袅凉风动，凄凄寒露零。寒露之后夜更长，适合把心事写下来，交给熟睡的自己。' },
  { name: '霜降', month: 10, day: 23, text: '霜叶红于二月花。霜降染红山野，也提醒我们：褪去青涩，才有沉静的好看。' },
  { name: '立冬', month: 11, day: 7, text: '细雨生寒未有霜，庭前木叶半青黄。立冬藏养，把劲儿收进身体里，等一场厚积薄发。' },
  { name: '小雪', month: 11, day: 22, text: '满空乱雪花，飘忽来天涯。小雪初寒，煮一壶热茶，把日子过成慢镜头。' },
  { name: '大雪', month: 12, day: 7, text: '夜深知雪重，时闻折竹声。大雪封山，也封不住想家的念头——回家，是最暖的远行。' },
  { name: '冬至', month: 12, day: 22, text: '冬至阳生春又来。这一天白昼最短，却也是光开始回返的转折点，再长的夜也会亮。' },
  { name: '小寒', month: 1, day: 6, text: '小寒胜大寒，常见不稀奇。最冷的日子往往最安静，正好用来想清楚一件事。' },
  { name: '大寒', month: 1, day: 20, text: '旧雪未及消，新雪又拥户。大寒是冬的终章，熬过它，春天就在下一页等你。' }
];

// 常用节日（month/day 为公历；农历节日近似到公历方便匹配，文案卡用途足够）
const FESTIVALS = [
  { name: '元旦', month: 1, day: 1, text: '一元复始，万象更新。新年第一天，把愿望写小一点、做踏实一点，反而更容易成真。' },
  { name: '情人节', month: 2, day: 14, text: '爱要大声说，也要慢慢做。今天不必盛大，一句真心话，抵得过一打玫瑰。' },
  { name: '妇女节', month: 3, day: 8, text: '她首先是自己，然后才是谁的妻、谁的母。今天，祝每一个她，都被温柔以待。' },
  { name: '劳动节', month: 5, day: 1, text: '劳动的人，最体面。今天把奖章别在心里：你流过的汗，都算数。' },
  { name: '青年节', month: 5, day: 4, text: '青春不是年纪，是还敢做梦的心。五四这天，允许自己再热血一次。' },
  { name: '儿童节', month: 6, day: 1, text: '愿你出走半生，归来仍是少年。儿童节不只对小孩，也对心里那个没长大的自己。' },
  { name: '教师节', month: 9, day: 10, text: '一支粉笔，两袖清风，三尺讲台，四季耕耘。今天，给那位改变过你的老师，道声谢谢。' },
  { name: '国庆节', month: 10, day: 1, text: '山河远阔，国泰民安。长假里，把匆忙放下，好好看看身边的烟火人间。' },
  { name: '中秋节', month: 9, day: 17, text: '但愿人长久，千里共婵娟。月亮圆了，盼归的人也该圆了——回家吃饭，别让座位空着。' },
  { name: '重阳节', month: 10, day: 11, text: '独在异乡为异客，每逢佳节倍思亲。重阳登高，也把牵挂寄给家里的老人。' },
  { name: '感恩节', month: 11, day: 27, text: '谢谢你来过我的生命。感恩不必等节日，今天就把谢意，说给那个一直在的人。' },
  { name: '圣诞节', month: 12, day: 25, text: '铃声响起，心愿亮灯。平安夜里，祝你平安，也祝所有等待，都有回响。' }
];

// 今日标签（9月30日 · 星期三）
function dateLabelOf(d) {
  const dt = d || new Date();
  const wk = '日一二三四五六'.charAt(dt.getDay());
  return (dt.getMonth() + 1) + '月' + dt.getDate() + '日 · 星期' + wk;
}

// 返回今日应景文案：节气 > 节日 > 普通日兜底。
// 返回 { type:'term'|'festival'|'normal', name, text }
function pickForToday(date) {
  const d = date || new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const term = SOLAR_TERMS.find(t => t.month === m && t.day === day);
  if (term) return { type: 'term', name: term.name + ' · 节气', text: term.text };
  const f = FESTIVALS.find(t => t.month === m && t.day === day);
  if (f) return { type: 'festival', name: f.name, text: f.text };
  return { type: 'normal', name: dateLabelOf(d), text: '今天也是值得记录的一天。把此刻的心情，写成一张小卡，留给往后的自己。' };
}

module.exports = { SOLAR_TERMS, FESTIVALS, pickForToday, solarTerms: () => SOLAR_TERMS, festivals: () => FESTIVALS, dateLabelOf };
