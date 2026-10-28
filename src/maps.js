/*
 * Prepared maps. Each map is drawn on a letter grid: one letter per region,
 * '.' for sea. core.js turns the grid into smooth borders; checker.js reads
 * neighbors straight from the grid.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapSpecs = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return [
    {
      id: 'corners',
      title: 'Four corners',
      seed: 11,
      cell: 46,
      jitter: 0.22,
      note:
        'Six regions. In the middle, B, C, E and F meet at a single point: B and E touch ' +
        'only there, so they are not neighbors and may share a color. The same goes for C and F.',
      grid: [
        '............',
        '..AABBBCC...',
        '.AAABBBCCDD.',
        '.AAABBBCCDD.',
        '..AAFFFEEDD.',
        '..AFFFFEEDD.',
        '...FFF.EEED.',
        '............',
      ],
    },
    {
      id: 'ring',
      title: 'Five around one',
      seed: 5,
      cell: 42,
      jitter: 0.22,
      note:
        'Five regions form a ring around F. A ring of five cannot be colored with two ' +
        'colors, and F touches all five, so this map needs all four colors.',
      grid: [
        '.............',
        '...AAAABBB...',
        '..AAAAABBBB..',
        '..EEAFFFBBB..',
        '..EEEFFFCCC..',
        '..EEEFFDCCC..',
        '...EEDDDDCC..',
        '....DDDDD....',
        '.............',
      ],
    },
    {
      id: 'trap',
      title: 'Greedy trap',
      seed: 3,
      cell: 40,
      jitter: 0.22,
      note:
        'Ten regions, and four colors are enough. Run greedy in alphabetical order and see ' +
        'where it gets stuck, then run backtracking with the same order.',
      grid: [
        '................',
        '...HHAAAAAII....',
        '..HHHAAAAAIII...',
        '..HFFAAAAABII...',
        '..FFFGGGGBBI....',
        '..FFFGGGGBBJ....',
        '..FFFGGGGBBJJ...',
        '..EFFDDDDBBJJ...',
        '..EEEDDDDCCJ....',
        '...EEEEECCC.....',
        '................',
      ],
    },
    {
      id: 'continent',
      title: 'Continent',
      seed: 9,
      cell: 36,
      jitter: 0.22,
      note:
        'Fifteen regions. Compare the orders: greedy gets stuck with some of them and not ' +
        'with others. With an unlucky order, backtracking has to go back hundreds of times.',
      grid: [
        '.................',
        '..AAABBBBCCC.....',
        '.AAAABBBBCCCDD...',
        '.AAEEEBBFFCCDDD..',
        '..EEEEGGFFFHHDD..',
        '..IEEGGGFFHHHH...',
        '.IIIJGGKKKHHLL...',
        '.IIJJJKKKKLLLL...',
        '..IJJJMMKKNNLL...',
        '..IIMMMMNNNNO....',
        '...MMMMNNNOOO....',
        '.................',
      ],
    },
  ];
});
