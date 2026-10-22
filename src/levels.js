const regions = [
  ['初识坐标', '从一个数字，找到下一步。', 7, 8, .15],
  ['边界之间', '把相邻的线索连起来。', 8, 9, .17],
  ['交叉线索', '有时，答案在两个数字之间。', 9, 10, .18],
  ['迂回小径', '向前之前，也可以绕一点路。', 9, 12, .20],
  ['纵深探索', '走得更远，也看得更仔细。', 10, 13, .21],
  ['最后一公里', '终点不远了，相信你的推理。', 11, 14, .22],
];
export const LEVELS = regions.flatMap(([region, note, cols, rows, density], chapter) =>
  Array.from({ length: 5 }, (_, step) => ({
    id: chapter * 5 + step, chapter, region, note, cols, rows,
    mineCount: Math.round(cols * rows * density) + (step % 3),
    seed: 38249 + chapter * 8701 + step * 1297,
    name: ['第一步', '小心求证', '换个角度', '循迹而行', '抵达彼岸'][step],
  })),
);
export const CHAPTERS = regions.map(([name], id) => ({ id, name }));
