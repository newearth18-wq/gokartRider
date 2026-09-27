export const TRACKS = [
  {
    id: 'meadow', name: 'สวนสายรุ้ง', subtitle: 'ทางโค้งกว้าง · ทุ่งหญ้า', icon: '🌈',
    sky: 0x83d7ff, fog: 0xc0ecff, ground: 0x80cf80, verge: 0x51ae68,
    road: 0x636d77, rail: 0x3188d1, foliage: 0x37a978, mountain: 0x91bec3,
    decor: 'garden',
    points: [[0,0,0],[65,1,32],[148,3,66],[236,1,55],[278,0,-20],[248,2,-95],[169,4,-132],[85,1,-105],[14,2,-144],[-68,3,-120],[-137,1,-54],[-141,0,27],[-80,2,81],[-23,1,69]],
  },
  {
    id: 'canyon', name: 'หุบเขาทอง', subtitle: 'โค้งต่อเนื่อง · อุโมงค์หิน', icon: '🏜️',
    sky: 0xffc57a, fog: 0xffd6a1, ground: 0xd99a5c, verge: 0xb97849,
    road: 0x77665c, rail: 0xe0a344, foliage: 0x5c9c64, mountain: 0xbb7754,
    decor: 'canyon',
    points: [[0,0,0],[58,2,13],[115,5,54],[197,6,41],[236,7,-16],[211,9,-83],[143,7,-107],[112,8,-178],[30,6,-186],[-37,5,-146],[-111,4,-169],[-167,1,-94],[-130,1,-21],[-80,0,46],[-20,0,65]],
  },
  {
    id: 'snow', name: 'ยอดเขาหิมะ', subtitle: 'ทางไต่ระดับ · ป่าสน', icon: '❄️',
    sky: 0x9dcffa, fog: 0xdbedff, ground: 0xebf5fa, verge: 0xa8d2d7,
    road: 0x5d7082, rail: 0x2687c8, foliage: 0x2d8e8d, mountain: 0xb4cddd,
    decor: 'snow',
    points: [[0,1,0],[68,3,23],[128,6,80],[190,10,50],[226,14,-22],[181,16,-78],[121,13,-70],[83,11,-126],[25,10,-162],[-54,8,-149],[-116,6,-94],[-165,2,-31],[-131,0,48],[-62,0,65]],
  },
  {
    id: 'harbor', name: 'เมืองริมอ่าว', subtitle: 'โค้งเมือง · แสงไฟ', icon: '🌊',
    sky: 0x7ec6f2, fog: 0xc3e5fa, ground: 0x94c9ad, verge: 0x58b5a9,
    road: 0x505f73, rail: 0x236eb6, foliage: 0x399f8d, mountain: 0x8caebc,
    decor: 'harbor',
    points: [[0,0,0],[78,0,10],[157,0,25],[240,0,15],[265,0,-61],[199,0,-85],[190,0,-163],[109,0,-174],[55,0,-125],[-31,0,-145],[-106,0,-102],[-134,0,-30],[-101,0,47],[-39,0,57]],
  },
];

export const CHARACTERS = [
  { id: 'nova', name: 'โนวา', title: 'นักซิ่งดาวรุ่ง', suit: 0x1977e8, helmet: 0x258def, accent: 0xf5faff, kart: 0x188bef, style: 'helmet', face: '⭐' },
  { id: 'poppy', name: 'ป๊อปปี้', title: 'ราชินีทางโค้ง', suit: 0xff71aa, helmet: 0xf960a2, accent: 0xffd6e7, kart: 0xfa6496, style: 'buns', face: '🌸' },
  { id: 'riko', name: 'ริโก้', title: 'จิ้งจอกสายฟ้า', suit: 0xf78a22, helmet: 0xf4a52a, accent: 0xfff0c8, kart: 0xff922e, style: 'fox', face: '⚡' },
  { id: 'momo', name: 'โมโม่', title: 'หมีน้อยจอมพลัง', suit: 0xe4f5f4, helmet: 0xf5f7f0, accent: 0x82dbe2, kart: 0x81d9e2, style: 'bear', face: '🐻' },
  { id: 'luna', name: 'ลูน่า', title: 'นักเดินทางราตรี', suit: 0x8067e8, helmet: 0x917cf5, accent: 0xffe680, kart: 0x8368e9, style: 'ears', face: '🌙' },
  { id: 'mint', name: 'มินต์', title: 'สปีดสเตอร์สีเขียว', suit: 0x41cbb2, helmet: 0x51d9aa, accent: 0xe7fff1, kart: 0x39c6a0, style: 'cap', face: '🍀' },
];

export const MAX_PLAYERS = 50;
export const RACE_LAPS = 4;
